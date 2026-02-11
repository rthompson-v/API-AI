// Función para agregar usuario Reclutador/Gerente
export async function addRecruiterManager(req, res) {
  try {
    const {
      Name,
      Experiencia,
      Skillset,
      Location,
      EnglishLevel,
      Linkedin,
      Telefono,
      Email,
      CV,
      Expectativas,
      Esquema,
      Rol,
      Tecnologia
    } = req.body;

    // Validación básica
    if (!Name || !Email || !Rol) {
      return res.status(400).json({ ok: false, error: "Faltan campos obligatorios: Name, Email, Rol" });
    }

    // Generar candidate_code único (puedes mejorar este método)
    const candidateCode = `RM-${Date.now()}`;

    const sql = `INSERT INTO candidate (
      candidate_code, full_name, phone, email, cv_url, location_id, role_id, english_score, years_experience, expectativas, esquema, skillset, tecnologia, linkedin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      candidateCode,
      Name,
      Telefono,
      Email,
      CV,
      Location,
      Rol,
      EnglishLevel,
      Experiencia,
      Expectativas,
      Esquema,
      Skillset,
      Tecnologia,
      Linkedin
    ];

    const [result] = await pool.query(sql, values);
    return res.status(201).json({ ok: true, id: result.insertId, message: "Usuario agregado correctamente" });
  } catch (err) {
    console.error("Error en addRecruiterManager:", err);
    return res.status(500).json({ ok: false, error: "Error agregando usuario Reclutador/Gerente" });
  }
}
import pool from "../db.js";

export async function profileView(req, res) {
  try {
    const [rows] = await pool.query(`
      SELECT *
      FROM v_candidate_profile
    `);

    res.status(200).json({
      ok: true,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("Error en /candidates/profile-view:", err);
    res.status(500).json({
      ok: false,
      error: "Error consultando la vista v_candidate_profile",
    });
  }
}

export async function candidatesSearch(req, res) {
  try {
    const qRaw = String(req.body?.q ?? "").trim();
    const limit = Math.min(Number(req.body?.limit ?? 50), 200);
    const offset = Math.max(Number(req.body?.offset ?? 0), 0);

    const searchable = [
      "candidate_code",
      "full_name",
      "email",
      "phone",
      "status",
      "role",
      "location",
      "seniority",
      "availability_notes",
      "cost_text",
      "available_from",
      "available_to",
      "years_experience",
      "english_score",
      "suggested_customer_contractor_rate",
      "suggested_customer_employee_rate",
    ];

    if (!qRaw) {
      const [rows] = await pool.query(
        `
        SELECT *
        FROM v_candidate_profile
        ORDER BY candidate_id DESC
        LIMIT ? OFFSET ?
        `,
        [limit, offset]
      );
      return res.json({ ok: true, count: rows.length, data: rows });
    }

    const tokens = qRaw.split(/\s+/).filter(Boolean);

    const fieldFilters = [];
    const freeTokens = [];

    for (const t of tokens) {
      const m = t.match(/^([a-zA-Z_]+):(.+)$/);
      if (m) {
        const field = m[1];
        const value = m[2];
        const aliasMap = {
          name: "full_name",
          english: "english_score",
          exp: "years_experience",
        };
        const col = aliasMap[field] || field;
        if (searchable.includes(col)) {
          fieldFilters.push({ col, value });
          continue;
        }
      }
      freeTokens.push(t);
    }

    const whereParts = [];
    const params = [];

    for (const ff of fieldFilters) {
      whereParts.push(`(${ff.col} LIKE ?)`);
      params.push(`%${ff.value}%`);
    }

    for (const token of freeTokens) {
      const like = `%${token}%`;
      const orParts = searchable.map((col) => `(${col} LIKE ?)`);
      whereParts.push(`(${orParts.join(" OR ")})`);
      params.push(...searchable.map(() => like));
    }

    if (whereParts.length === 0) {
      whereParts.push(`(full_name LIKE ?)`);
      params.push(`%${qRaw}%`);
    }

    const numericMatch = qRaw.match(/-?\d+(\.\d+)?/);
    const n = numericMatch ? Number(numericMatch[0]) : null;

    let orderSql = "";
    if (n !== null && Number.isFinite(n)) {
      orderSql = `
        ORDER BY
          ABS(IFNULL(english_score, 999999) - ?) ASC,
          IFNULL(english_score, -1) DESC,
          full_name ASC
      `;
      params.push(n);
    } else {
      orderSql = `
        ORDER BY
          (full_name LIKE CONCAT(?, '%')) DESC,
          full_name ASC
      `;
      params.push(freeTokens[0] ?? qRaw);
    }

    params.push(limit, offset);

    const sql = `
      SELECT *
      FROM v_candidate_profile
      WHERE ${whereParts.join(" AND ")}
      ${orderSql}
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(sql, params);

    return res.json({
      ok: true,
      q: qRaw,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error("Error en POST /candidates/search:", err);
    return res.status(500).json({ ok: false, error: "Error buscando candidatos" });
  }
}

export async function profileViewByRole(req, res) {
  try {
    const role = String(req.query?.role ?? req.body?.role ?? "normal").toLowerCase();
    const limit = Math.min(Number(req.query?.limit ?? req.body?.limit ?? 100), 1000);
    const offset = Math.max(Number(req.query?.offset ?? req.body?.offset ?? 0), 0);

    const [rows] = await pool.query(
      `
      SELECT *
      FROM v_candidate_profile
      ORDER BY candidate_id DESC
      LIMIT ? OFFSET ?
    `,
      [limit, offset]
    );

    const fieldSpecs = {
      normal: [
        "full_name",
        "years_experience",
        "skillset",
        "last_update",
        "location",
        "english_score",
        "linkedin",
      ],
      usuario: [
        "full_name",
        "years_experience",
        "skillset",
        "last_update",
        "location",
        "english_score",
        "linkedin",
        "phone",
        "email",
        "cv",
      ],
      gerente: [
        "full_name",
        "years_experience",
        "skillset",
        "last_update",
        "location",
        "english_score",
        "linkedin",
        "phone",
        "email",
        "cv",
        "tarifa",
        "costo_expectativa",
      ],
    };

    const aliases = {
      full_name: ["full_name", "name", "candidate_name"],
      years_experience: [
        "years_experience",
        "experiencia",
        "experience",
        "yrs_experience",
      ],
      skillset: ["skillset", "skills", "skill_set"],
      last_update: [
        "last_update",
        "updated_at",
        "lastupdate",
        "historial",
        "history",
      ],
      location: ["location", "place", "city"],
      english_score: ["english_score", "english_level", "english"],
      linkedin: ["linkedin", "linkedin_url"],
      phone: ["phone", "telefono", "phone_number"],
      email: ["email", "email_address"],
      cv: ["cv", "cv_url", "resume", "resume_url"],
      tarifa: [
        "tarifa",
        "rate",
        "suggested_customer_contractor_rate",
        "suggested_rate",
      ],
      costo_expectativa: [
        "costo_expectativa",
        "cost_expectation",
        "expected_cost",
        "cost_text",
      ],
    };

    function resolveField(row, key) {
      const names = aliases[key] || [key];
      for (const n of names) {
        if (Object.prototype.hasOwnProperty.call(row, n) && row[n] !== undefined) {
          return row[n];
        }
      }
      return null;
    }

    const keysToUse = fieldSpecs[role] || fieldSpecs.normal;

    const data = rows.map((r) => {
      const out = {};
      for (const k of keysToUse) {
        const v = resolveField(r, k);
        if (v !== null && v !== undefined) out[k] = v;
      }
      if (Object.prototype.hasOwnProperty.call(r, "candidate_id")) {
        out.candidate_id = r.candidate_id;
      }
      return out;
    });

    return res.status(200).json({ ok: true, role, count: data.length, data });
  } catch (err) {
    console.error("Error en /candidates/profile-view-by-role:", err);
    return res.status(500).json({ ok: false, error: "Error consultando la vista v_candidate_profile" });
  }
}
