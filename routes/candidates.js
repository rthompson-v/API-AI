import express from "express";
import { profileView, candidatesSearch, profileViewByRole, addRecruiterManager} from "../controllers/candidatesController.js";

const router = express.Router();

router.get("/profile-view", profileView);
router.post("/search", candidatesSearch);
router.post("/profile-view-by-role", profileViewByRole);
router.post("/add-recruiter-manager", addRecruiterManager);

export default router;
