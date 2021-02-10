module.exports = {
    extends: ["plugin:@typescript-eslint/recommended", "plugin:prettier/recommended"],
    rules: {
        // "object-curly-newline": ["error", { multiline: true, consistent: true }],
        "newline-per-chained-call": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/camelcase": "off",
        "@typescript-eslint/no-this-alias": "off",
        "@typescript-eslint/class-name-casing": "off",
        semi: "off",
        "@typescript-eslint/semi": "off",
        "@typescript-eslint/member-delimiter-style": "off",
        "max-len": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off"
    }
}
