// Example maplibre-yaml configuration file

export default {
  // Validation settings
  validate: {
    strict: false,              // Treat warnings as errors
    ignorePatterns: [
      '**/drafts/**',
      '**/test/**',
    ],
  },

  // Preview server settings
  preview: {
    port: 3000,
    open: true,
    debug: false,
  },

  // Default config paths
  configs: [
    'src/maps/**/*.yaml',
  ],
};
