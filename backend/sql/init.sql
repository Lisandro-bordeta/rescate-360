-- SHIELD - DDL inicial (PostgreSQL + PostGIS)
-- Ejecutar como superusuario o rol con privilegios de creación de extensiones.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------
-- Tabla: usuarios
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dni VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    apellido VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    telefono VARCHAR(30),
    sub_mi_arg VARCHAR(255) UNIQUE NOT NULL,        -- subject de OIDC (Mi Argentina)
    nivel_vulnerabilidad VARCHAR(20) NOT NULL
        CHECK (nivel_vulnerabilidad IN ('estandar','niño','adulto_mayor','discapacidad'))
        DEFAULT 'estandar',
    fcm_token TEXT,
    rol VARCHAR(20) NOT NULL DEFAULT 'ciudadano'
        CHECK (rol IN ('ciudadano','rescatista','admin')),
    refugio_asignado_id UUID,                        -- FK opcional a refugios
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------
-- Tabla: refugios
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS refugios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(200) NOT NULL,
    direccion VARCHAR(255),
    tipo VARCHAR(20) NOT NULL
        CHECK (tipo IN ('urbano','rural'))
        DEFAULT 'urbano',
    capacidad INTEGER NOT NULL DEFAULT 0,
    ocupacion_actual INTEGER NOT NULL DEFAULT 0,
    ubicacion_lat NUMERIC(10,7) NOT NULL,
    ubicacion_lon NUMERIC(10,7) NOT NULL,
    ubicacion GEOGRAPHY(POINT,4326) NOT NULL
        GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(ubicacion_lon, ubicacion_lat), 4326)::geography) STORED,
    zona_segura_wkt TEXT,                            -- WKT del polígono de zona segura
    zona_segura GEOMETRY(POLYGON,4326)               -- columna espacial PostGIS
        GENERATED ALWAYS AS (ST_GeomFromText(zona_segura_wkt, 4326)) STORED,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refugios_ubicacion ON refugios USING GIST (ubicacion);
CREATE INDEX IF NOT EXISTS idx_refugios_zona_segura ON refugios USING GIST (zona_segura);

-- -----------------------------------------------------
-- Tabla: alertas_inundacion
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS alertas_inundacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona VARCHAR(100) NOT NULL,
    nivel_agua NUMERIC(6,2) NOT NULL,                -- cm sobre nivel base
    tipo_alerta VARCHAR(20) NOT NULL
        CHECK (tipo_alerta IN ('verde','amarilla','naranja','roja'))
        DEFAULT 'verde',
    geom_wkt TEXT NOT NULL,                          -- WKT del polígono/multipolígono anegado
    geom GEOMETRY(MULTIPOLYGON,4326)
        GENERATED ALWAYS AS (ST_GeomFromText(geom_wkt, 4326)) STORED,
    fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_fin TIMESTAMPTZ,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_geom ON alertas_inundacion USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_alertas_activa ON alertas_inundacion (activo, fecha_inicio);

-- -----------------------------------------------------
-- Tabla: tracking_ubicacion
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS tracking_ubicacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    latitud NUMERIC(10,7) NOT NULL,
    longitud NUMERIC(10,7) NOT NULL,
    ubicacion GEOGRAPHY(POINT,4326)
        GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitud, latitud), 4326)::geography) STORED,
    precision NUMERIC(6,2),                          -- metros
    bateria INTEGER CHECK (bateria BETWEEN 0 AND 100),
    dispositivo_id VARCHAR(100),
    secuencia_local INTEGER NOT NULL,                -- secuencia del cliente para dedup offline
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sincronizado BOOLEAN NOT NULL DEFAULT FALSE,
    enviado_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tracking_usuario_fecha ON tracking_ubicacion (usuario_id, fecha_registro DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_sincronizado ON tracking_ubicacion (sincronizado);
CREATE INDEX IF NOT EXISTS idx_tracking_ubicacion ON tracking_ubicacion USING GIST (ubicacion);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_usuario_secuencia ON tracking_ubicacion (usuario_id, secuencia_local);

-- -----------------------------------------------------
-- Tabla: cola_sms_sos
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS cola_sms_sos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    mensaje TEXT NOT NULL,
    telefono_destino VARCHAR(30) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','enviado','fallido')),
    intentos INTEGER NOT NULL DEFAULT 0,
    max_intentos INTEGER NOT NULL DEFAULT 5,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enviado_en TIMESTAMPTZ,
    ultimo_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_cola_sms_pendiente ON cola_sms_sos (estado, creado_en) WHERE estado = 'pendiente';

-- -----------------------------------------------------
-- Tabla: cola_eventos (eventos SOS / estado salud recibidos del móvil)
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS cola_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
    tipo VARCHAR(20) NOT NULL
        CHECK (tipo IN ('ubicacion','sos','estado_salud')),
    payload JSONB NOT NULL DEFAULT '{}',
    creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado VARCHAR(20) NOT NULL DEFAULT 'procesado'
        CHECK (estado IN ('procesado','fallido'))
);

CREATE INDEX IF NOT EXISTS idx_cola_eventos_usuario ON cola_eventos (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_cola_eventos_tipo ON cola_eventos (tipo, creado_en);

-- -----------------------------------------------------
-- Vista: última ubicación conocida por usuario
-- -----------------------------------------------------
CREATE OR REPLACE VIEW vw_ultima_ubicacion_por_usuario AS
SELECT DISTINCT ON (t.usuario_id)
    t.usuario_id,
    t.latitud,
    t.longitud,
    t.ubicacion,
    t.precision,
    t.bateria,
    t.fecha_registro AS ultima_actualizacion,
    u.dni,
    u.nombre,
    u.apellido,
    u.nivel_vulnerabilidad,
    u.rol,
    u.refugio_asignado_id,
    r.nombre AS refugio_asignado,
    r.zona_segura AS refugio_zona_segura
FROM tracking_ubicacion t
JOIN usuarios u ON u.id = t.usuario_id AND u.activo = TRUE
LEFT JOIN refugios r ON r.id = u.refugio_asignado_id AND r.activo = TRUE
ORDER BY t.usuario_id, t.fecha_registro DESC;

-- Comentarios de documentación
COMMENT ON TABLE usuarios IS 'Ciudadanos y rescatistas autenticados vía Mi Argentina (OIDC).';
COMMENT ON TABLE refugios IS 'Refugios de evacuación urbanos y rurales con zona segura poligonal.';
COMMENT ON TABLE alertas_inundacion IS 'Polígonos de zonas anegadas por alertas de inundación.';
COMMENT ON TABLE tracking_ubicacion IS 'Trazas GPS de usuarios, con marca de sincronización offline.';
COMMENT ON TABLE cola_sms_sos IS 'Cola de SMS de emergencia (fallback sin datos).';