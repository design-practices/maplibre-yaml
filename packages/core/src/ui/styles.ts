/**
 * @file Loading UI styles
 * @module @maplibre-yaml/core/ui/styles
 */

/**
 * CSS styles for loading overlays and spinners.
 *
 * @remarks
 * Includes:
 * - Loading overlay with backdrop
 * - Circle spinner animation
 * - Dots spinner animation
 * - Error overlay with icon and retry button
 * - Dark mode support
 * - Reduced motion support
 */
export const loadingStyles = `
/* Loading Overlay */
.mly-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.mly-loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.mly-loading-text {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  color: #374151;
  font-weight: 500;
}

/* Circle Spinner */
.mly-spinner--circle {
  width: 40px;
  height: 40px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: mly-spin 0.8s linear infinite;
}

@keyframes mly-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Dots Spinner */
.mly-spinner--dots {
  display: flex;
  gap: 8px;
}

.mly-spinner--dots::before,
.mly-spinner--dots::after {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #3b82f6;
  animation: mly-dots 1.4s infinite ease-in-out both;
}

.mly-spinner--dots::before {
  animation-delay: -0.32s;
}

.mly-spinner--dots::after {
  animation-delay: -0.16s;
}

@keyframes mly-dots {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

/* Error Overlay */
.mly-loading-overlay--error {
  background: rgba(254, 242, 242, 0.95);
}

.mly-error-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 300px;
  padding: 20px;
  text-align: center;
}

.mly-error-icon {
  font-size: 32px;
  line-height: 1;
}

.mly-error-text {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  color: #991b1b;
  font-weight: 500;
}

.mly-retry-button {
  padding: 8px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: white;
  background: #dc2626;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.mly-retry-button:hover {
  background: #b91c1c;
}

.mly-retry-button:active {
  background: #991b1b;
}

/* Dark Mode Support */
@media (prefers-color-scheme: dark) {
  .mly-loading-overlay {
    background: rgba(17, 24, 39, 0.85);
  }

  .mly-loading-text {
    color: #e5e7eb;
  }

  .mly-spinner--circle {
    border-color: #374151;
    border-top-color: #60a5fa;
  }

  .mly-spinner--dots::before,
  .mly-spinner--dots::after {
    background: #60a5fa;
  }

  .mly-loading-overlay--error {
    background: rgba(127, 29, 29, 0.95);
  }

  .mly-error-text {
    color: #fecaca;
  }
}

/* Reduced Motion Support */
@media (prefers-reduced-motion: reduce) {
  .mly-spinner--circle {
    animation: none;
    border-top-color: #3b82f6;
    opacity: 0.7;
  }

  .mly-spinner--dots::before,
  .mly-spinner--dots::after {
    animation: none;
    opacity: 0.7;
  }

  .mly-retry-button {
    transition: none;
  }
}
`;

/**
 * Inject loading styles into the document.
 *
 * @remarks
 * Automatically called when the loading manager is first used.
 * Only injects styles once, even if called multiple times.
 *
 * @example
 * ```typescript
 * import { injectLoadingStyles } from '@maplibre-yaml/core/ui/styles';
 *
 * // Manually inject styles
 * injectLoadingStyles();
 * ```
 */
export function injectLoadingStyles(): void {
  const styleId = "mly-loading-styles";

  // Check if styles already injected
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = loadingStyles;
  document.head.appendChild(style);
}
