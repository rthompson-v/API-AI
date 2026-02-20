import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Protege rutas: requiere JWT válido en Authorization: Bearer <token>
 * Si es válido, inyecta req.user con el payload del token.
 */
export function requireAuth(req, res, next) {
  try {
    if (!JWT_SECRET) {
      return res.status(500).json({ ok: false, error: "JWT_SECRET no configurado" });
    }

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "No autorizado (sin token)" });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    // payload típico: { USER_CLP, Role_CLP, RoleName, iat, exp }
    req.user = payload;

    return next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
}

/**
 * Restringe por IDs de rol (Role_CLP) dentro del token.
 * Uso: router.get("/admin", requireAuth, requireRoleIds([1,2]), handler)
 */
export function requireRoleIds(allowedRoleIds = []) {
  const allowed = allowedRoleIds.map(String);

  return (req, res, next) => {
    const roleId = String(req.user?.Role_CLP ?? "");

    if (!roleId) {
      return res.status(403).json({ ok: false, error: "Sin rol en token" });
    }

    if (!allowed.includes(roleId)) {
      return res.status(403).json({ ok: false, error: "Sin permisos" });
    }

    return next();
  };
}

/**
 * Opcional: Restringe por nombre de rol (RoleName) si lo incluyes en el token.
 * Uso: router.get("/admin", requireAuth, requireRoleNames(["Admin"]), handler)
 */
export function requireRoleNames(allowedRoleNames = []) {
  const allowed = allowedRoleNames.map(r => String(r).toLowerCase());

  return (req, res, next) => {
    const roleName = String(req.user?.RoleName ?? "").toLowerCase();

    if (!roleName) {
      return res.status(403).json({ ok: false, error: "Sin RoleName en token" });
    }

    if (!allowed.includes(roleName)) {
      return res.status(403).json({ ok: false, error: "Sin permisos" });
    }

    return next();
  };
}