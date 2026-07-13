// @atlitos/ui-native eslint config, composed from the shared @atlitos/config base.
// See docs/design/DESIGN-LANGUAGE.md and CLAUDE.md for the house rules this
// enforces (no raw hex outside packages/theme, no emoji in string literals).
const atlitos = require("@atlitos/config/eslint");

module.exports = [...atlitos];
