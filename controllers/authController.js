
import { pool2 } from "../db.js";

export async function login(req, res) {
  try {
    const { USER_CLP, PASS_CLP } = req.body || {};
    if (!USER_CLP || !PASS_CLP) return res.status(400).json({ error: "Faltan credenciales" });

    // Consulta la tabla de usuarios en la segunda BD
    const [rows] = await pool2.query(
      `SELECT * FROM usuarios WHERE USER_CLP = ? LIMIT 1`,
      [USER_CLP]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

    // Comparación de contraseña (texto plano, puedes adaptar a hash si lo implementas)
    const ok = PASS_CLP === user.PASS_CLP;
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    // Elimina la contraseña antes de responder
    delete user.PASS_CLP;
    res.json({ ok: true, user });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    res.status(500).json({ ok: false, error: "Error en autenticación" });
  }
}
