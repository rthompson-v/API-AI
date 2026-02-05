import pool from "../db.js";
import bcrypt from "bcryptjs";

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Faltan credenciales" });

    const [rows] = await pool.query(`SELECT * FROM users WHERE email = ? LIMIT 1`, [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

    const hashed = user.password;
    let ok = false;
    if (hashed && typeof hashed === "string" && hashed.startsWith("$2")) {
      ok = await bcrypt.compare(password, hashed);
    } else {
      // Fallback (si la DB tiene contraseñas en texto plano — no recomendado)
      ok = password === hashed;
    }

    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    // No generamos JWT aquí (puedes añadirlo fácilmente más adelante)
    delete user.password;
    res.json({ ok: true, user });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    res.status(500).json({ ok: false, error: "Error en autenticación" });
  }
}
