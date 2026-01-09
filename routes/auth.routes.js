const router = require("express").Router();
const { signup, login, getUsers, getUser, updateProfile } = require("../controllers/auth.controller");
const { auth } = require("../middleware/auth.middleware");
const upload = require("../config/multer");

router.post("/signup", upload.single("profileImage"), signup);
router.post("/login", login);
router.get("/users", auth, getUsers);
router.get("/user", auth, getUser);
router.put("/profile", auth, upload.single("profileImage"), updateProfile);

module.exports = router;
