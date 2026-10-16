import { env } from '../config/env';

/**
 * Gateway de SMS con estrategia de proveedor intercambiable:
 *  - `twilio`   : API REST de Twilio (puente en el exterior).
 *  - `gsm-modem`: modem GSM gubernamental expuesto como servicio HTTP local (AT commands).
 *  - `mock`     : solo loguea (desarrollo / tests).
 */

export const sendSms = async (to: string, message: string): Promise<void> => {
  switch (env.SMS_PROVIDER) {
    case 'twilio':
      return sendViaTwilio(to, message);
    case 'gsm-modem':
      return sendViaGsmModem(to, message);
    case 'mock':
    default:
      console.log(`[SMS:mock] -> ${to}: ${message}`);
      return;
  }
};

const sendViaTwilio = async (to: string, body: string): Promise<void> => {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('Credenciales Twilio ausentes (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).');
  }

  const credentials = Buffer.from(
    `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`,
  ).toString('base64');

  const form = new URLSearchParams({
    To: to,
    From: env.TWILIO_FROM_NUMBER,
    Body: body,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    },
  );

  if (!res.ok) {
    throw new Error(`Twilio rechazó el SMS (HTTP ${res.status}): ${await res.text()}`);
  }
};

const sendViaGsmModem = async (to: string, body: string): Promise<void> => {
  if (!env.SMS_MODEM_URL) {
    throw new Error('Falta SMS_MODEM_URL (endpoint del servicio del modem GSM).');
  }

  const res = await fetch(env.SMS_MODEM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, body }),
  });

  if (!res.ok) {
    throw new Error(`Modem GSM respondió HTTP ${res.status}: ${await res.text()}`);
  }
};
