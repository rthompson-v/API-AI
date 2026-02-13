import express from "express";
import { profileView, candidatesSearch, profileViewByRole, addRecruiterManager} from "../controllers/candidatesController.js";

const router = express.Router();

router.get("/profile-view", profileView);

router.get("/catalogs/locations", getLocations);
router.get("/catalogs/roles", getRoles);
router.get("/catalogs/technologies", getTechnologies);
router.get("/catalogs/technologies/:technology_id/modules", getModulesByTechnology);
router.get("/catalogs/modules/:module_id/submodules", getSubmodulesByModule);
router.post("/profile-view-by-role", profileViewByRole);
router.post("/add-recruiter-manager", addRecruiterManager);
router.post("/search", candidatesSearch)

export default router;
