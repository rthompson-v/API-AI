import express from "express";
import { requireAuth, requireRoleIds } from "../middlewares/auth.js";
import {
  profileView,
  candidatesSearch,
  profileViewByRole,
  addRecruiterManager,
  getLocations,
  getRoles,
  getTechnologies,
  getSubmodulesByModule,
  getModulesByTechnology,
  updateCandidateByCode,
  getCandidateByCode,       // ← agregado
} from "../controllers/candidatesController.js";

const router = express.Router();

// ── Client Portal ─────────────────────────────────────────────────────────────
router.get("/profile-view", profileView);
router.post("/search", candidatesSearch);

// ── User Talent System ────────────────────────────────────────────────────────
router.get("/catalogs/locations",                         requireAuth, getLocations);
router.get("/catalogs/roles",                             requireAuth, getRoles);
router.get("/catalogs/technologies",                      requireAuth, getTechnologies);
router.get("/catalogs/technologies/:technology_id/modules", requireAuth, getModulesByTechnology);
router.get("/catalogs/modules/:module_id/submodules",     requireAuth, getSubmodulesByModule);
router.post("/profile-view-by-role",  requireAuth, requireRoleIds([1, 2, 3]), profileViewByRole);
router.post("/", requireAuth, requireRoleIds([1, 2, 3]), addRecruiterManager);
router.put("/update/:candidate_code", requireAuth, requireRoleIds([1, 2, 3]), updateCandidateByCode);
router.get("/:candidate_code",        requireAuth, requireRoleIds([1, 2, 3]), getCandidateByCode); // ← agregado

export default router;