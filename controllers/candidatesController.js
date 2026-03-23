import { pool1 } from "../db.js";

export async function profileView(req, res) {
  try {
    const [rows] = await pool1.query(`
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
    const tier = resolveTier(req.user);
    const qRaw = String(req.body?.q ?? "").trim();
    const limit = Math.min(Number(req.body?.limit ?? 50), 200);

    //Campos de texto buscables con LIKE
    const textSearchable = [
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
      "hiring_preference",
      "technologies",  
      "skills",        
    ];

    //Campos numéricos — usan = o BETWEEN, nunca LIKE
    const numericFields = [
      "english_score",
      "years_experience",
      "suggested_customer_contractor_rate",
      "suggested_customer_employee_rate",
    ];

    //Campos de fecha
    const dateFields = ["available_from", "available_to"];

    const allSearchable = [...textSearchable, ...numericFields, ...dateFields];

    // ─── Sin query: trae últimos ────────────────────────────────────────────
    if (!qRaw) {
      const [rows] = await pool1.query(
        `SELECT * FROM v_candidate_profile ORDER BY candidate_id DESC LIMIT ?`,
        [limit]
      );
      return res.json({ ok: true, tier, q: "", count: rows.length, data: applyTier(rows, tier) });
    }

    // ─── Tokenización ───────────────────────────────────────────────────────
    const tokens = qRaw.split(/\s+/).filter(Boolean);
    const fieldFilters = [];
    const freeTokens = [];

    const aliasMap = {
      name:     "full_name",
      english:  "english_score",
      exp:      "years_experience",
      rate:     "suggested_customer_contractor_rate",
      location: "location",
      role:     "role",
      tech:     "technologies",
      pref:     "hiring_preference",
    };

    for (const t of tokens) {
      // Soporte field:value  Y  field:min-max (rangos)
      const m = t.match(/^([a-zA-Z_]+):(.+)$/);
      if (m) {
        const col = aliasMap[m[1]] || m[1];
        if (allSearchable.includes(col)) {
          // Rango numérico  ej: exp:3-5
          const range = m[2].match(/^(\d+\.?\d*)-(\d+\.?\d*)$/);
          if (range && numericFields.includes(col)) {
            fieldFilters.push({ col, type: "range", min: Number(range[1]), max: Number(range[2]) });
          } else if (numericFields.includes(col) && !isNaN(Number(m[2]))) {
            fieldFilters.push({ col, type: "numeric", value: Number(m[2]) });
          } else {
            fieldFilters.push({ col, type: "like", value: m[2] });
          }
          continue;
        }
      }
      freeTokens.push(t);
    }

    // ─── Construcción WHERE ─────────────────────────────────────────────────
    const whereParts = [];
    const params = [];

    // Filtros field:value
    for (const ff of fieldFilters) {
      if (ff.type === "range") {
        whereParts.push(`(${ff.col} BETWEEN ? AND ?)`);
        params.push(ff.min, ff.max);
      } else if (ff.type === "numeric") {
        whereParts.push(`(${ff.col} = ?)`);
        params.push(ff.value);
      } else {
        whereParts.push(`(${ff.col} LIKE ?)`);
        params.push(`%${ff.value}%`);
      }
    }

    // Free tokens — texto busca en textSearchable, números buscan en numericFields
    for (const token of freeTokens) {
      const isNum = !isNaN(Number(token)) && token !== "";
      const orParts = [];

      if (isNum) {
        //Numérico: busca coincidencia exacta en campos numéricos
        for (const col of numericFields) {
          orParts.push(`(${col} = ?)`);
          params.push(Number(token));
        }
      }

      // Siempre busca en campos de texto también
      for (const col of textSearchable) {
        orParts.push(`(${col} LIKE ?)`);
        params.push(`%${token}%`);
      }

      if (orParts.length) {
        whereParts.push(`(${orParts.join(" OR ")})`);
      }
    }

    if (whereParts.length === 0) {
      whereParts.push(`(full_name LIKE ?)`);
      params.push(`%${qRaw}%`);
    }

    // ─── Ordenación ─────────────────────────────────────────────────────────
    const firstNum = freeTokens.find(t => !isNaN(Number(t)) && t !== "");
    let orderSql = "";

    if (firstNum !== undefined) {
      // Si buscó un número, ordena por proximidad al valor numérico
      orderSql = `
        ORDER BY
          ABS(IFNULL(english_score, 999999) - ?) ASC,
          ABS(IFNULL(years_experience, 999999) - ?) ASC,
          full_name ASC
      `;
      params.push(Number(firstNum), Number(firstNum));
    } else {
      orderSql = `
        ORDER BY
          (full_name LIKE CONCAT(?, '%')) DESC,
          full_name ASC
      `;
      params.push(freeTokens[0] ?? qRaw);
    }

    params.push(limit);

    const sql = `
      SELECT *
      FROM v_candidate_profile
      WHERE ${whereParts.join(" AND ")}
      ${orderSql}
      LIMIT ?
    `;

    const [rows] = await pool1.query(sql, params);
    return res.json({ ok: true, tier, q: qRaw, count: rows.length, data: applyTier(rows, tier) });

  } catch (err) {
    console.error("Error en POST /candidates/search:", err);
    return res.status(500).json({ ok: false, error: "Error buscando candidatos" });
  }
}

// ─── Helper: aplica fieldSpecs del tier Y garantiza campos nuevos ──────────
function applyTier(rows, tier) {
  const keysToUse = fieldSpecs[tier] || fieldSpecs.normal;

  
  const alwaysInclude = [
    "candidate_id",
    "hiring_preference",
    "hiring_preference_id",
    "technologies",
    "skills",
  ];

  return rows.map(r => {
    const out = {};

    // Siempre incluir candidate_id
    if (Object.prototype.hasOwnProperty.call(r, "candidate_id")) {
      out.candidate_id = r.candidate_id;
    }

    // Campos del tier
    for (const k of keysToUse) {
      const v = resolveField(r, k);
      if (v !== null && v !== undefined) out[k] = v;
    }

    
    for (const k of alwaysInclude) {
      if (!(k in out) && Object.prototype.hasOwnProperty.call(r, k)) {
        const v = r[k];
        if (v !== null && v !== undefined) out[k] = v;
      }
    }

    return out;
  });
}

function resolveTier(reqUser) {
  const roleName = String(reqUser?.RoleName ?? "").toLowerCase();
  const roleId = Number(reqUser?.Role_CLP);

  // Ajusta estos IDs a los reales de tu tabla ROLE_USER
  // Ejemplo: 1=Administrador, 2=Gerente, 3=Usuario, etc.
  const byId = {
    1: "usuario",
    2: "gerente",
    3: "administrador",
  };

  if (Number.isFinite(roleId) && byId[roleId]) return byId[roleId];

  // fallback por nombre
  if (roleName.includes("admin")) return "administrador";
  if (roleName.includes("gerente")) return "gerente";
  if (roleName.includes("usuario")) return "usuario";

  return "normal";
}

const fieldSpecs = {
  normal: [
    "candidate_code",
    "full_name",
    "years_experience",
    "skillset",
    "last_update",
    "location",
    "english_score",
    "linkedin",
  ],
  usuario: [
    "candidate_code",
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
    "candidate_code",
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
  administrador: [
    "candidate_code",
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
  years_experience: ["years_experience", "experiencia", "experience", "yrs_experience"],
  skillset: ["skillset", "skills", "skill_set"],
  last_update: ["last_update", "updated_at", "lastupdate", "historial", "history"],
  location: ["location", "place", "city"],
  english_score: ["english_score", "english_level", "english"],
  linkedin: ["linkedin", "linkedin_url"],
  phone: ["phone", "telefono", "phone_number"],
  email: ["email", "email_address"],
  cv: ["cv", "cv_url", "resume", "resume_url"],
  tarifa: ["tarifa", "rate", "suggested_customer_contractor_rate", "suggested_rate"],
  costo_expectativa: ["costo_expectativa", "cost_expectation", "expected_cost", "cost_text"],
};

function resolveField(row, key) {
  const names = aliases[key] || [key];
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n) && row[n] !== undefined) return row[n];
  }
  return null;
}



export async function profileViewByRole(req, res) {
  try {
    const tier  = resolveTier(req.user);
    const limit = Math.min(Number(req.body?.limit ?? req.query?.limit ?? 20), 100);
    const page  = Math.max(Number(req.body?.page  ?? req.query?.page  ?? 1), 1);
    const offset = (page - 1) * limit;

    // Total de registros (para calcular páginas)
    const [[{ total }]] = await pool1.query(
      `SELECT COUNT(*) AS total FROM v_candidate_profile`
    );

    const [rows] = await pool1.query(
      `
      SELECT *
      FROM v_candidate_profile
      ORDER BY candidate_id DESC
      LIMIT ? OFFSET ?
      `,
      [limit, offset]
    );

    const keysToUse = fieldSpecs[tier] || fieldSpecs.normal;

    const data = rows.map((r) => {
      const out = {};
      if (Object.prototype.hasOwnProperty.call(r, "candidate_id")) out.candidate_id = r.candidate_id;
      for (const k of keysToUse) {
        const v = resolveField(r, k);
        if (v !== null && v !== undefined) out[k] = v;
      }
      return out;
    });

    return res.status(200).json({
      ok: true,
      tier,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      count: data.length,
      data,
    });
  } catch (err) {
    console.error("Error en /candidates/profile-view-by-role:", err);
    return res.status(500).json({ ok: false, error: "Error consultando v_candidate_profile" });
  }
}
//Insercion------------------------------------------------------------------------------------------------------------------------------
// Función para agregar usuario Reclutador/Gerente
export async function addRecruiterManager(req, res) {
  const conn = await pool1.getConnection();

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
      Visa,         // no existe columna -> candidate_note
      HiringPreference  // id o nombre -> candidate.hiring_preference_id
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

    const hiringPreferenceId = await resolveId({
      table: "catalog_hiring_preference",
      idCol: "hiring_preference_id",
      nameCol: "name",
      value: HiringPreference
    });

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
        location_id, role_id, english_score, years_experience, hiring_preference_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        candidateCode,
        Name,
        Telefono || null,
        Email || null,
        CV || null,
        locationId,
        roleId,
        EnglishLevel ?? null,
        Experiencia ?? null,
        hiringPreferenceId || null
      ]
    );

    const candidateId = candRes.insertId;

    // 2) INSERT compensation (solo Expectativas)
    if (Expectativas) {
      await conn.query(
        `INSERT INTO candidate_compensation (candidate_id, cost_text) VALUES (?, ?)`,
        [candidateId, Expectativas || null]
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
    const [rows] = await pool1.query(
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
    const [rows] = await pool1.query(
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
    const [rows] = await pool1.query(
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
    const [rows] = await pool1.query(
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
    const [rows] = await pool1.query(
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

export async function getHiringPreferences(req, res) {
  try {
    const [rows] = await pool1.query(
      `SELECT hiring_preference_id AS id, name
       FROM catalog_hiring_preference
       ORDER BY hiring_preference_id`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: "Error obteniendo hiring preferences" });
  }
}

export async function updateCandidateByCode(req, res) {
  const conn = await pool1.getConnection();

  try {
    const { candidate_code } = req.params;

    const {
      // candidate
      Name,
      Telefono,
      Email,
      CV,
      Location,       // id o nombre
      Rol,            // id o nombre
      EnglishLevel,   // 0-100
      Experiencia,

      // historicos / notas
      Expectativas,
      Esquema,
      Skillset,
      Visa,

      // stack
      Tecnologia,     // id/nombre o array
      Modulos,        // {technology,module,submodule} o array
      replaceStack,   // boolean
      HiringPreference  // id o nombre -> candidate.hiring_preference_id
    } = req.body;

    if (!candidate_code) {
      return res.status(400).json({ ok: false, error: "Falta candidate_code en params" });
    }

    // helper: array
    const toArray = (v) => (!v ? [] : Array.isArray(v) ? v : [v]);

    // helper: resolver ID por nombre o aceptar ID
    const resolveId = async ({ table, idCol, nameCol, value }) => {
      if (value === null || value === undefined || value === "") return null;

      if (typeof value === "number") return value;
      if (/^\d+$/.test(String(value).trim())) return Number(value);

      const [rows] = await conn.query(
        `SELECT ${idCol} AS id FROM ${table} WHERE ${nameCol} = ? LIMIT 1`,
        [String(value).trim()]
      );
      return rows.length ? rows[0].id : null;
    };

    // helpers: crear modulo/submodulo si no existe
    const getOrCreateModuleId = async (technologyId, moduleName) => {
      if (!moduleName) return null;

      const [rows] = await conn.query(
        `SELECT module_id FROM catalog_module
         WHERE technology_id = ? AND module_catalogname = ? LIMIT 1`,
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
        `SELECT submodule_id FROM catalog_submodule
         WHERE module_id = ? AND subm_catalog_name = ? LIMIT 1`,
        [moduleId, submoduleName]
      );
      if (rows.length) return rows[0].submodule_id;

      const [ins] = await conn.query(
        `INSERT INTO catalog_submodule (module_id, subm_catalog_name) VALUES (?, ?)`,
        [moduleId, submoduleName]
      );
      return ins.insertId;
    };

    await conn.beginTransaction();

    // 1) buscar candidato
    const [candRows] = await conn.query(
      `SELECT candidate_id FROM candidate WHERE candidate_code = ? LIMIT 1`,
      [candidate_code]
    );

    if (!candRows.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Candidato no encontrado" });
    }

    const candidateId = candRows[0].candidate_id;

    // 2) UPDATE candidate dinámico
    const set = [];
    const vals = [];

    if (Name !== undefined) { set.push("full_name = ?"); vals.push(Name); }
    if (Telefono !== undefined) { set.push("phone = ?"); vals.push(Telefono || null); }
    if (Email !== undefined) { set.push("email = ?"); vals.push(Email || null); }
    if (CV !== undefined) { set.push("cv_url = ?"); vals.push(CV || null); }

    if (EnglishLevel !== undefined) { set.push("english_score = ?"); vals.push(EnglishLevel ?? null); }
    if (Experiencia !== undefined) { set.push("years_experience = ?"); vals.push(Experiencia ?? null); }

    if (Location !== undefined) {
      // ajusta nameCol si tu location no usa "name"
      const locationId = await resolveId({
        table: "catalog_location",
        idCol: "location_id",
        nameCol: "name",
        value: Location
      });
      set.push("location_id = ?");
      vals.push(locationId);
    }

    if (Rol !== undefined) {
      const roleId = await resolveId({
        table: "catalog_role",
        idCol: "role_id",
        nameCol: "name",
        value: Rol
      });

      if (!roleId) {
        await conn.rollback();
        return res.status(400).json({ ok: false, error: "Rol inválido" });
      }

      set.push("role_id = ?");
      vals.push(roleId);
    }

    if (HiringPreference !== undefined) {
      const hpId = await resolveId({
        table: "catalog_hiring_preference",
        idCol: "hiring_preference_id",
        nameCol: "name",
        value: HiringPreference
      });
      set.push("hiring_preference_id = ?");
      vals.push(hpId || null);
    }

    if (set.length) {
      vals.push(candidateId);
      await conn.query(
        `UPDATE candidate SET ${set.join(", ")} WHERE candidate_id = ?`,
        vals
      );
    }

    // 3) compensation histórico (solo Expectativas)
    if (Expectativas !== undefined) {
      await conn.query(
        `INSERT INTO candidate_compensation (candidate_id, cost_text) VALUES (?, ?)`,
        [candidateId, Expectativas || null]
      );
    }

    // 4) notas históricas
    const notes = [];
    if (Skillset !== undefined && Skillset !== "") notes.push(["SKILLSET", typeof Skillset === "string" ? Skillset : JSON.stringify(Skillset)]);
    if (Visa !== undefined && Visa !== "") notes.push(["VISA", typeof Visa === "string" ? Visa : JSON.stringify(Visa)]);

    if (notes.length) {
      const rows = notes.map(([type, text]) => [candidateId, type, text]);
      await conn.query(
        `INSERT INTO candidate_note (candidate_id, note_type, note_text) VALUES ?`,
        [rows]
      );
    }

    // 5) stack
    if (replaceStack) {
      await conn.query(`DELETE FROM candidate_stack WHERE candidate_id = ?`, [candidateId]);
    }

    // 5a) tecnologías (sin módulos)
    if (Tecnologia !== undefined) {
      const techValues = toArray(Tecnologia);

      for (const t of techValues) {
        const techId = await resolveId({
          table: "catalog_technology",
          idCol: "technology_id",
          nameCol: "ct_name_tech",
          value: t
        });

        if (!techId) {
          await conn.rollback();
          return res.status(400).json({ ok: false, error: `Tecnologia inválida: "${t}"` });
        }

        await conn.query(
          `INSERT IGNORE INTO candidate_stack (candidate_id, technology_id, module_id, submodule_id)
           VALUES (?, ?, NULL, NULL)`,
          [candidateId, techId]
        );
      }
    }

    // 5b) módulos/submódulos
    if (Modulos !== undefined) {
      const mods = toArray(Modulos);

      for (const m of mods) {
        // technology requerido por cada módulo para no adivinar
        if (!m?.technology) {
          await conn.rollback();
          return res.status(400).json({
            ok: false,
            error: "En Modulos falta technology (manda id o nombre en m.technology)."
          });
        }

        const technologyId = await resolveId({
          table: "catalog_technology",
          idCol: "technology_id",
          nameCol: "ct_name_tech",
          value: m.technology
        });

        if (!technologyId) {
          await conn.rollback();
          return res.status(400).json({ ok: false, error: `Tecnologia inválida en Modulos: "${m.technology}"` });
        }

        const moduleName = String(m.module || "").trim();
        const submoduleName = String(m.submodule || "").trim();

        const moduleId = await getOrCreateModuleId(technologyId, moduleName || null);
        const submoduleId = await getOrCreateSubmoduleId(moduleId, submoduleName || null);

        await conn.query(
          `INSERT IGNORE INTO candidate_stack (candidate_id, technology_id, module_id, submodule_id)
           VALUES (?, ?, ?, ?)`,
          [candidateId, technologyId, moduleId, submoduleId]
        );
      }
    }

    await conn.commit();

    return res.json({
      ok: true,
      candidate_id: candidateId,
      candidate_code,
      message: "Candidato actualizado correctamente"
    });

  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error("Error en updateCandidateByCode:", err);

    if (err?.code === "ER_CHECK_CONSTRAINT_VIOLATED") {
      return res.status(400).json({ ok: false, error: "english_score debe estar entre 0 y 100 (o null)." });
    }

    return res.status(500).json({ ok: false, error: "Error actualizando candidato" });
  } finally {
    conn.release();
  }
}

export async function listCandidates(req, res) {
  try {
    const q = (req.query.q || "").trim();

    const sql = `
      SELECT
        c.candidate_code,
        c.full_name,
        c.email,
        c.phone,
        r.name AS role_name,
        l.name AS location_name,
        c.updated_at
      FROM candidate c
      LEFT JOIN catalog_role r ON r.role_id = c.role_id
      LEFT JOIN catalog_location l ON l.location_id = c.location_id
      WHERE (? = '' OR c.candidate_code LIKE CONCAT('%', ?, '%')
                  OR c.full_name LIKE CONCAT('%', ?, '%')
                  OR c.email LIKE CONCAT('%', ?, '%'))
      ORDER BY c.updated_at DESC
      LIMIT 100
    `;

    const [rows] = await pool1.query(sql, [q, q, q, q]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("listCandidates:", e);
    res.status(500).json({ ok: false, error: "Error listando candidatos" });
  }
}


export async function getCandidateByCode(req, res) {
  const conn = await pool1.getConnection();
  try {
    const { candidate_code } = req.params;

    const [candRows] = await conn.query(
      `SELECT *
       FROM candidate
       WHERE candidate_code = ?
       LIMIT 1`,
      [candidate_code]
    );

    if (!candRows.length) {
      return res.status(404).json({ ok: false, error: "Candidato no encontrado" });
    }

    const c = candRows[0];

    // Stack
    const [stack] = await conn.query(
      `SELECT
         cs.technology_id,
         t.ct_name_tech AS technology_name,
         cs.module_id,
         m.module_catalogname AS module_name,
         cs.submodule_id,
         s.subm_catalog_name AS submodule_name
       FROM candidate_stack cs
       LEFT JOIN catalog_technology t ON t.technology_id = cs.technology_id
       LEFT JOIN catalog_module m ON m.module_id = cs.module_id
       LEFT JOIN catalog_submodule s ON s.submodule_id = cs.submodule_id
       WHERE cs.candidate_id = ?
       ORDER BY t.ct_name_tech, m.module_catalogname, s.subm_catalog_name`,
      [c.candidate_id]
    );

    // Última compensation
    const [comp] = await conn.query(
      `SELECT cost_text, scheme, recorded_at
       FROM candidate_compensation
       WHERE candidate_id = ?
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [c.candidate_id]
    );

    // Última nota VISA y SKILLSET
    const [visa] = await conn.query(
      `SELECT note_text, recorded_at
       FROM candidate_note
       WHERE candidate_id = ? AND note_type = 'VISA'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [c.candidate_id]
    );

    const [skill] = await conn.query(
      `SELECT note_text, recorded_at
       FROM candidate_note
       WHERE candidate_id = ? AND note_type = 'SKILLSET'
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [c.candidate_id]
    );

    return res.json({
      ok: true,
      data: {
        candidate: c,
        stack,
        lastCompensation: comp[0] || null,
        lastVisa: visa[0] || null,
        lastSkillset: skill[0] || null
      }
    });
  } catch (e) {
    console.error("getCandidateByCode:", e);
    res.status(500).json({ ok: false, error: "Error obteniendo candidato" });
  } finally {
    conn.release();
  }
}