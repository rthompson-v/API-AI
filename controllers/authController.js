import { pool2 } from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

export async function login(req, res) {
  try {
    const { USER_CLP, PASS_CLP } = req.body || {};

    if (!USER_CLP || !PASS_CLP) {
      return res.status(400).json({ ok: false, error: "Faltan credenciales" });
    }

    if (!JWT_SECRET) {
      return res.status(500).json({ ok: false, error: "JWT_SECRET no configurado" });
    }

    const [rows] = await pool2.query(
      `
      SELECT 
        u.USER_CLP,
        u.ROLE_CLP AS Role_CLP,
        ru.ROLE_NAME AS RoleName,
        u.PASS_CLP
      FROM Usuario u
      LEFT JOIN ROLE_USER ru ON ru.ID_ROLE = u.ROLE_CLP
      WHERE u.USER_CLP = ?
      LIMIT 1
      `,
      [USER_CLP]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }

    //bcrypt: PASS_CLP en DB debe ser hash bcrypt
    const passOk = await bcrypt.compare(PASS_CLP, user.PASS_CLP);
    if (!passOk) {
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }

    const payload = {
      USER_CLP: user.USER_CLP,
      Role_CLP: user.Role_CLP,        // ID del rol
      RoleName: user.RoleName || null // Nombre del rol
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });

    return res.json({ ok: true, token, user: payload });
  } catch (err) {
    console.error("Error en /auth/login:", err);
    return res.status(500).json({ ok: false, error: "Error en autenticación" });
  }
}