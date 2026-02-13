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
//Insercion------------------------------------------------------------------------------------------------------------------------------
// Función para agregar usuario Reclutador/Gerente
export async function addRecruiterManager(req, res) {
  const conn = await pool.getConnection();

  try {
    const {
      Name,
      Experiencia,
      Skillset,     // opcional: string (texto libre) o array; lo guardaremos en NOTE
      Location,     // puede ser ID o nombre
      EnglishLevel, // 0-100
      Linkedin,
      Telefono,
      Email,
      CV,
      Expectativas, // texto libre -> candidate_compensation.cost_text
      Esquema,      // texto libre -> candidate_compensation.scheme
      Rol,          // puede ser ID o nombre
      Tecnologia,   // puede ser ID o nombre (o array si quieres varias)
      Modulos,      // opcional: { module, submodule } o array de esos
      Visa          // no existe columna -> candidate_note
    } = req.body;

    // Validación mínima
    if (!Name || !Rol) {
      return res.status(400).json({
        ok: false,
        error: "Faltan campos obligatorios: Name, Rol"
      });
    }

    const toArray = (v) => {
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    };

    // Helpers para resolver IDs por nombre (o aceptar ID directo)
    const resolveId = async ({ table, idCol, nameCol, value }) => {
      if (value === null || value === undefined || value === "") return null;

      // si ya es número -> lo tratamos como ID
      if (typeof value === "number") return value;
      if (/^\d+$/.test(String(value).trim())) return Number(value);

      // si es nombre -> buscamos
      const [rows] = await conn.query(
        `SELECT ${idCol} AS id FROM ${table} WHERE ${nameCol} = ? LIMIT 1`,
        [String(value).trim()]
      );
      return rows.length ? rows[0].id : null;
    };

    // Resolver FKs
    const locationId = await resolveId({
      table: "catalog_location",
      idCol: "location_id",
      nameCol: "name",
      value: Location
    });

    const roleId = await resolveId({
      table: "catalog_role",
      idCol: "role_id",
      nameCol: "name",
      value: Rol
    });

    if (!roleId) {
      return res.status(400).json({
        ok: false,
        error: "Rol inválido: no existe en catalog_role (manda role_id o name exacto)."
      });
    }

    // Tecnología: permitimos 1 o varias
    const techValues = toArray(Tecnologia);
    const techIds = [];
    for (const t of techValues) {
      const techId = await resolveId({
        table: "catalog_technology",
        idCol: "technology_id",
        nameCol: "ct_name_tech",
        value: t
      });
      if (!techId) {
        return res.status(400).json({
          ok: false,
          error: `Tecnologia inválida: "${t}" no existe en catalog_technology (manda technology_id o name exacto).`
        });
      }
      techIds.push(techId);
    }

    // Normalizar módulos: array de { technology, module, submodule } o { module, submodule }
    // Si no trae technology, usamos la primera tecnologia (o la única)
    const modulesArr = toArray(Modulos).map((m) => {
      if (!m) return null;
      if (typeof m === "string") {
        // si mandan "Module/Submodule" en texto, lo separamos simple
        const [moduleName, submoduleName] = m.split("/").map(x => x?.trim()).filter(Boolean);
        return { module: moduleName || null, submodule: submoduleName || null };
      }
      return {
        technology: m.technology ?? null,
        module: m.module ?? null,
        submodule: m.submodule ?? null
      };
    }).filter(Boolean);

    const candidateCode = `RM-${Date.now()}`;

    await conn.beginTransaction();

    // 1) INSERT candidate (datos base)
    const [candRes] = await conn.query(
      `INSERT INTO candidate (
        candidate_code, full_name, phone, email, cv_url,
        location_id, role_id, english_score, years_experience
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        candidateCode,
        Name,
        Telefono || null,
        Email || null,
        CV || null,
        locationId,
        roleId,
        EnglishLevel ?? null,
        Experiencia ?? null
      ]
    );

    const candidateId = candRes.insertId;

    // 2) INSERT compensation (Expectativas + Esquema)
    if (Expectativas || Esquema) {
      await conn.query(
        `INSERT INTO candidate_compensation (candidate_id, cost_text, scheme)
         VALUES (?, ?, ?)`,
        [candidateId, Expectativas || null, Esquema || null]
      );
    }

    // 3) INSERT notes (Skillset, Visa) usando candidate_note
    //    (tu esquema no tiene columnas directas para eso)
    const notesToInsert = [];
    if (Skillset) notesToInsert.push(["SKILLSET", typeof Skillset === "string" ? Skillset : JSON.stringify(Skillset)]);
    if (Visa) notesToInsert.push(["VISA", typeof Visa === "string" ? Visa : JSON.stringify(Visa)]);

    if (notesToInsert.length) {
      const rows = notesToInsert.map(([type, text]) => [candidateId, type, text]);
      await conn.query(
        `INSERT INTO candidate_note (candidate_id, note_type, note_text) VALUES ?`,
        [rows]
      );
    }

    // 4) INSERT candidate_stack (Tecnologia + Modulos/Submodulos)
    // Si no hay Modulos, insertamos solo tecnología (module_id/submodule_id null)
    const stackRows = [];

    const resolveModuleId = async (technologyId, moduleName) => {
      if (!moduleName) return null;
      const [r] = await conn.query(
        `SELECT module_id FROM catalog_module WHERE technology_id = ? AND module_catalogname = ? LIMIT 1`,
        [technologyId, moduleName]
      );
      return r.length ? r[0].module_id : null;
    };

    const resolveSubmoduleId = async (moduleId, submoduleName) => {
      if (!moduleId || !submoduleName) return null;
      const [r] = await conn.query(
        `SELECT submodule_id FROM catalog_submodule WHERE module_id = ? AND subm_catalog_name = ? LIMIT 1`,
        [moduleId, submoduleName]
      );
      return r.length ? r[0].submodule_id : null;
    };

    const getOrCreateModuleId = async (technologyId, moduleName) => {
  if (!moduleName) return null;

  const [rows] = await conn.query(
    `SELECT module_id FROM catalog_module WHERE technology_id = ? AND module_catalogname = ? LIMIT 1`,
    [technologyId, moduleName]
  );
  if (rows.length) return rows[0].module_id;

  const [ins] = await conn.query(
    `INSERT INTO catalog_module (technology_id, module_catalogname) VALUES (?, ?)`,
    [technologyId, moduleName]
  );
  return ins.insertId;
};

const getOrCreateSubmoduleId = async (moduleId, submoduleName) => {
  if (!moduleId || !submoduleName) return null;

  const [rows] = await conn.query(
    `SELECT submodule_id FROM catalog_submodule WHERE module_id = ? AND subm_catalog_name = ? LIMIT 1`,
    [moduleId, submoduleName]
  );
  if (rows.length) return rows[0].submodule_id;

  const [ins] = await conn.query(
    `INSERT INTO catalog_submodule (module_id, subm_catalog_name) VALUES (?, ?)`,
    [moduleId, submoduleName]
  );
  return ins.insertId;
};



    if (modulesArr.length === 0) {
      // solo tecnologías
      for (const technologyId of techIds) {
        stackRows.push([candidateId, technologyId, null, null]);
      }
    } else {
      for (const m of modulesArr) {
  let technologyId = techIds[0];

  // Si el módulo trae technology explícita, resolverla con la MISMA columna correcta
  if (m.technology) {
    const tId = await resolveId({
      table: "catalog_technology",
      idCol: "technology_id",
      nameCol: "ct_name_tech", // <-- importante
      value: m.technology
    });

    if (!tId) {
      return res.status(400).json({
        ok: false,
        error: `Tecnologia en Modulos inválida: "${m.technology}"`
      });
    }
    technologyId = tId;
  }


        const moduleName = (m.module || "").trim().replace(/^phyton$/i, "Python");
        const submoduleName = (m.submodule || "").trim().replace(/^phyton$/i, "Python");
        const moduleId = await getOrCreateModuleId(technologyId, moduleName);
        const submoduleId = await getOrCreateSubmoduleId(moduleId, submoduleName);
        

        stackRows.push([candidateId, technologyId, moduleId, submoduleId]);
      }
    }

    if (stackRows.length) {
      await conn.query(
        `INSERT IGNORE INTO candidate_stack (candidate_id, technology_id, module_id, submodule_id)
         VALUES ?`,
        [stackRows]
      );
    }

    await conn.commit();

    return res.status(201).json({
      ok: true,
      candidate_id: candidateId,
      candidate_code: candidateCode,
      message: "Candidato agregado correctamente (candidate + stack + compensation + notes)"
    });

  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error("Error en addRecruiterManager:", err);

    // chequeo de constraints comunes
    if (err?.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
      return res.status(400).json({ ok: false, error: "english_score debe estar entre 0 y 100 (o null)." });
    }

    return res.status(500).json({
      ok: false,
      error: "Error agregando candidato multi-tabla"
    });
  } finally {
    conn.release();
  }
}

export async function getLocations(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT location_id AS id, name
       FROM catalog_location
       ORDER BY name`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo locations" });
  }
}

export async function getRoles(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT role_id AS id, name
       FROM catalog_role
       ORDER BY name`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo roles" });
  }
}

export async function getTechnologies(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT technology_id AS id, ct_name_tech AS name
       FROM catalog_technology
       ORDER BY ct_name_tech`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo tecnologías" });
  }
}

export async function getModulesByTechnology(req, res) {
  try {
    const { technology_id } = req.params;
    const [rows] = await pool.query(
      `SELECT module_id AS id, module_catalogname AS name
       FROM catalog_module
       WHERE technology_id = ?
       ORDER BY module_catalogname`,
      [technology_id]
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo módulos" });
  }
}

export async function getSubmodulesByModule(req, res) {
  try {
    const { module_id } = req.params;
    const [rows] = await pool.query(
      `SELECT submodule_id AS id, subm_catalog_name AS name
       FROM catalog_submodule
       WHERE module_id = ?
       ORDER BY subm_catalog_name`,
      [module_id]
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo submódulos" });
  }
}
