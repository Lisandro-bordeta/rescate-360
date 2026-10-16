# SHIELD — Arquitectura de Sistema

Sistema de respuesta rápida y evacuación ante inundaciones severas, integrado al ecosistema público **Mi Argentina**.

---

## 1. Visión general

SHIELD coordina la gestión de emergencias por inundación en entornos **urbanos y rurales**, valida la identidad del ciudadano mediante **Mi Argentina (OIDC / OAuth 2.0 vía AUTENTICATOR)**, prioriza a grupos vulnerables y opera de forma **resiliente sin conectividad** (offline-first, cola de sincronización, fallback SMS/mesh).

---

## 2. Diagrama de componentes

```mermaid
graph TB
    subgraph Ciudadano / Equipo de rescate
        USER[Usuario / Rescatista]
    end

    subgraph App Móvil (React Native + Expo)
        APP[App SHIELD]
        AUTH[Login OIDC - Mi Argentina / expo-auth-session]
        LOCALDB[(SQLite local - expo-sqlite)]
        QUEUE[Cola de sincronización offline]
        MAP[Mapa de evacuación - react-native-maps / MBTiles offline]
        LOC[Geolocalización - expo-location]
        NET[NetInfo - detección de red]
        SMS[Canal SMS/Mesh fallback]
    end

    subgraph Capa de Identidad (Estado)
        MA[Mi Argentina - OIDC Provider\nAUTENTICAR\nJWKS / Introspección]
    end

    subgraph API Shield (Node.js + TypeScript + Express)
        API[REST API + WebSocket Socket.io]
        AUTH_MW[Middleware JWT]
        SYNC[Endpoint batch ubicaciones offline]
        RESCUE[Endpoint lista prioridad búsqueda y rescate]
        ALERTS[Alertas de inundación PostGIS]
    end

    subgraph Datos Espaciales
        DB[(PostgreSQL + PostGIS)]
    end

    subgraph Notificaciones y Fallback
        FCM[Firebase Cloud Messaging]
        WS[WebSocket tiempo real]
        GW[SMS Gateway estatal\nTwilio / Modem GSM gubernamental]
        SENS[Sensores / Cámaras / Satélites\nnivel de agua]
    end

    USER --> APP
    APP --> AUTH
    AUTH -->|OIDC PKCE / scopes| MA
    APP --> LOCALDB
    LOCALDB --> QUEUE
    APP --> MAP
    APP --> LOC
    APP --> NET
    APP --> SMS
    NET -->|online / offline| QUEUE
    QUEUE -->|retry exp. backoff| API
    SMS -->|SOS coordenadas comprimidas| GW
    API --> AUTH_MW
    AUTH_MW -->|valida token| MA
    API --> SYNC
    API --> RESCUE
    API --> ALERTS
    API --> DB
    API --> WS
    API --> FCM
    DB -->|GeoJSON capas vectoriales| MAP
    SENS -->|ingesta nivel agua| ALERTS
    FCM -.->|push emergencia| APP
    WS -.->|alertas tiempo real| APP
    GW -->|SMS de estado| APP

    style APP fill:#e1f5fe
    style DB fill:#fff3e0
    style MA fill:#e8f5e9
    style GW fill:#ffebee
```

---

## 3. Flujo de autenticación (SSO Mi Argentina)

1. El usuario abre SHIELD y pulsa **"Iniciar sesión con Mi Argentina"**.
2. `expo-auth-session` inicia un `AuthRequest` contra el issuer de Mi Argentina con **PKCE** y scopes `openid profile email phone` (identidad básica).
3. Mi Argentina autentica al ciudadano y redirige con el **authorization code**.
4. La app intercambia el code por `id_token` / `access_token`.
5. Los tokens se guardan de forma segura (Keychain/Keystore vía `expo-secure-store`; caché de sesión en `AsyncStorage`).
6. La app llama a `POST /auth/mi-argentina/login` de la API Shield enviando el `id_token`.
7. La API valida el `id_token` contra los **JWKS de Mi Argentina** (issuer, audience, firma), crea o recupera el `usuario` y devuelve un **JWT de sesión SHIELD** (válido 8h, refresh token opcional).
8. El JWT se usa en `Authorization: Bearer <token>` y se cachea para uso offline; al expirar, se renueva o se obliga a reautenticar con Mi Argentina si hay red.

---

## 4. Flujo offline / resiliencia de red

| Situación | Acción |
|-----------|--------|
| **Con conectividad** | Ubicaciones y eventos SOS se envían en tiempo real a `POST /sync/locations-batch`. |
| **Sin conectividad** | `NetInfo` detecta pérdida de señal. Las trazas GPS y alertas se guardan en SQLite con `secuencia_local` y `estado = pendiente`. |
| **Recupera conexión** | `SyncService` vacía la cola con **retry + exponential backoff** (base 1s, tope 60s, máx. 5 intentos). Los registros se marcan `sincronizado = true`. |
| **Pérdida total de datos (no 4G/3G/Wi-Fi)** | Superado el umbral sin red (ej. 10 min), se activa **Canal de Emergencia SMS/Mesh**: envío de coordenadas comprimidas + alerta SOS al gateway estatal por SMS. |
| **Mapas offline** | MBTiles / tiles vectoriales compactos descargados previamente de la zona de riesgo; renderizado sin servidor de tiles. |

---

## 5. Flujo Búsqueda y Rescate ("señales quietas")

1. `GET /rescue/priority-list` obtiene la **última ubicación conocida** de cada usuario activo (`DISTINCT ON usuario_id` ordenado por `fecha_registro DESC`).
2. Con **PostGIS / Turf** se evalúa:
   - ¿Está dentro de la **zona segura** asignada (`ST_Contains` sobre el polígono del refugio) o dentro de un buffer (ej. 500 m) (`ST_DWithin`)? Si no → `fuera_zona_segura = true`.
   - ¿Está **inmóvil** (`fecha_registro` > `OFFLINE_IMMOBILE_MINUTES` sin nueva traza)? Si sí → `inmóvil = true` ("señal quieta").
3. Se calcula un **score de prioridad** combinando:
   - Nivel de vulnerabilidad (`discapacidad` / `adulto_mayor` / `niño` > estándar).
   - Fuera de zona segura.
   - Inmovilidad.
   - Falta de contacto reciente.
4. Se retorna una **lista ordenada por prioridad** (alta/media/baja) para los equipos de rescate, con última coordenada, refugio asignado y nivel de vulnerabilidad.

---

## 6. Modelo de datos resumido

| Tabla | Descripción |
|-------|-------------|
| `usuarios` | Ciudadanos/rescatistas autenticados por Mi Argentina (`sub`), nivel de vulnerabilidad, token FCM, rol. |
| `refugios` | Refugios urbanos/rurales con punto geográfico y polígono de zona segura, capacidad y ocupación. |
| `alertas_inundacion` | Polígonos de zonas anegadas, nivel de agua, nivel de alerta (verde/amarilla/naranja/roja), vigencia. |
| `tracking_ubicacion` | Trazas GPS de usuarios, marca de sincronización offline y secuencia local para deduplicación. |
| `cola_sms_sos` | Cola de SMS de emergencia cuando no hay datos (estado, intentos, backoff). |

El DDL completo está en `backend/sql/init.sql`.

---

## 7. Seguridad

- Tokens OIDC validados contra JWKS de Mi Argentina (firma, issuer, aud, exp).
- JWT de SHIELD firmado con `HS256` (producción: rotar claves, considerar RS256/HSM).
- Contraseñas no se almacenan (identidad federada); si existe auth local, `bcryptjs` con factor de costo 12.
- Endpoints de rescate restringidos a roles `rescatista` / `admin`.
- TLS 1.2+ obligatorio; CORS restringido a dominios de la app y Mi Argentina.
- Datos de ubicación tratados como sensibles; acceso auditado.

---

## 8. Variables de entorno (`.env`)

```ini
PORT=3001
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shield_db
JWT_SECRET=cambiar_en_produccion_alta_entropia
JWT_EXPIRES_IN=8h

MI_ARGENTINA_ISSUER=https://auth.miargentina.gob.ar
MI_ARGENTINA_CLIENT_ID=shield-client-id
MI_ARGENTINA_JWKS_URI=https://auth.miargentina.gob.ar/.well-known/jwks.json

SOCKET_IO_CORS_ORIGIN=https://app.shield.gob.ar
SMS_GATEWAY_NUMBER=+5491100000000
OFFLINE_IMMOBILE_MINUTES=30
OFFLINE_SMS_FALLBACK_MINUTES=10
SAFE_ZONE_BUFFER_METERS=500
```

---

## 9. Estructura del repositorio

```
shield/
├── docs/ARCHITECTURE.md
├── backend/                  # API Node.js + TypeScript + TypeORM + PostGIS
│   ├── package.json
│   ├── tsconfig.json
│   ├── ormconfig.ts
│   ├── sql/init.sql
│   └── src/
│       ├── config/env.ts
│       ├── database/datasource.ts
│       ├── entities/*.ts
│       ├── modules/auth/
│       ├── modules/sync/
│       ├── modules/rescue/
│       ├── modules/alerts/
│       ├── middleware/auth.middleware.ts
│       ├── utils/oidc.ts
│       ├── app.ts
│       └── server.ts
└── mobile/                   # App React Native + Expo
    ├── package.json
    ├── app.json
    ├── App.tsx
    └── src/
        ├── types/index.ts
        ├── database/localDB.ts
        ├── services/authService.ts
        ├── services/syncService.ts
        ├── services/smsService.ts
        ├── hooks/useAuth.ts
        ├── hooks/useOfflineSync.ts
        └── components/{LoginScreen,EvacuationMap,SOSButton}.tsx
```

---

## 10. Consideraciones de despliegue

- **Backend:** contenedor Docker (Node 20), variable `DATABASE_URL`, migraciones TypeORM al arrancar, PostGIS habilitado en la base.
- **Base de datos:** PostgreSQL 15+ + PostGIS 3.x, extensiones `postgis` y `pgcrypto`, índices GiST en columnas geométricas.
- **Móvil:** Expo Development Client o build de producción (`expo prebuild` + Android Studio / Xcode). Los tiles offline se incluyen en `assets/maps/` y se empaquetan en el binario.
- **Push:** configurar FCM en `google-services.json` (Android) y `GoogleService-Info.plist` (iOS).
- **SMS:** integrar gateway estatal (Twilio como puente o modem GSM gubernamental por USB/Bluetooth con AT commands).