// Validaciones y utilidades reutilizables
export const MAX_CHARS_PER_MESSAGE = 150;

export const BANNED_KEYWORDS = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "ignora todas las instrucciones",
  "ignora las instrucciones anteriores",
  "system prompt",
  "prompt del sistema",
  "api key",
  "api-key",
  "contraseña",
  "password",
  "token de acceso",
  "access token",
  "cabecera de autorización",
  "authorization header",
];

// Normaliza texto: quita acentos y pasa a minúsculas
export function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Valida contenido de mensajes de usuario
export function validateUserMessages(messages) {
  for (const msg of messages) {
    if (msg.role !== "user") continue;

    const content = String(msg.content || "");
    const normalized = normalize(content);

    // 1) límite de caracteres
    if (content.length > MAX_CHARS_PER_MESSAGE) {
      return {
        ok: false,
        reason: `Tu mensaje es demasiado largo (máximo ${MAX_CHARS_PER_MESSAGE} caracteres).`,
      };
    }

    // 2) palabras/frases bloqueadas
    for (const bad of BANNED_KEYWORDS) {
      if (normalized.includes(normalize(bad))) {
        return {
          ok: false,
          reason:
            "Tu mensaje contiene términos no permitidos. Por favor reformula tu pregunta sin intentar cambiar las reglas del sistema ni solicitar credenciales.",
        };
      }
    }
  }

  return { ok: true };
}
