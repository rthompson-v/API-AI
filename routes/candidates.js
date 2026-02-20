import express from "express";
import { requireAuth, requireRoleIds } from "../middlewares/auth.js";
import { profileView, candidatesSearch, profileViewByRole, addRecruiterManager, getLocations, getRoles, getTechnologies, getSubmodulesByModule
, getModulesByTechnology, updateCandidateByCode, 
} from "../controllers/candidatesController.js";

const router = express.Router();


//Funciones de Permisos

router.get("/", requireAuth, getCandidates);
router.post("/", requireAuth, requireRoleIds([1, 2]), createCandidate);

//Funciones de Datos


router.get("/profile-view", profileView);

router.get("/catalogs/locations", getLocations);
router.get("/catalogs/roles", getRoles);
router.get("/catalogs/technologies", getTechnologies);
router.get("/catalogs/technologies/:technology_id/modules", getModulesByTechnology);
router.get("/catalogs/modules/:module_id/submodules", getSubmodulesByModule);
router.post("/profile-view-by-role", profileViewByRole);
router.post("/add-recruiter-manager", addRecruiterManager);
router.post("/search", candidatesSearch);
router.put("/update/:candidate_code", updateCandidateByCode);

export default router;
