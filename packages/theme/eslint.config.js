// @atlitos/theme eslint config, composed from the shared @atlitos/config base.
// This package IS the token source, so the house base already exempts it from
// the no raw hex rule (see packages/config/eslint.config.js houseRules); the
// no emoji rule still applies here like everywhere else.
const atlitos = require("@atlitos/config/eslint");

module.exports = [...atlitos];
