// eslint-disable-next-line no-undef
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: [
    '**/artifacts',
    '**/cache',
    '**/node_modules',
    '**/types/generated',
    '**/coverage',
    '**/coverage.json',
  ],
}
