const fs = require("fs");
const path = require("path");
function read(file) { return fs.readFileSync(path.join(process.cwd(), file), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(`POST-AUTH HYDRATION EVENT CONTRACT: ${message}`); }

const state = read("js/core/state.js");
const auth = read("js/core/auth.js");

assert(/window\.addEventListener\(\s*["']gv-auth-state-changed["']/.test(state), "state hydration must listen on window where auth dispatches the lifecycle event");
assert(/document\.addEventListener\(\s*["']gv-auth-state-changed["']/.test(state), "legacy document hydration listener must remain for compatibility");
assert(/window\.dispatchEvent\(\s*new CustomEvent\(\s*["']gv-auth-state-changed["']/.test(auth), "auth must dispatch the lifecycle event on window");
assert(state.includes("scheduleAuthorizedHydration()"), "authenticated state hydration scheduler must remain connected");
assert(state.includes("selectResource"), "post-auth hydration must read canonical cloud resources");
assert(state.includes("replaceState(next)"), "post-auth hydration must promote cloud rows into application state");
assert(state.includes("renderAll()"), "post-auth hydration must render the hydrated canonical state");

console.log("POST-AUTH HYDRATION EVENT CONTRACT: PASS");
