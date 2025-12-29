/**
 * @file Template metadata types
 */

/**
 * Template metadata schema
 */
export interface TemplateMetadata {
  name: string;
  description: string;
  version: string;
  variables?: TemplateVariable[];
  postInstall?: string[];
}

/**
 * Template variable definition
 */
export interface TemplateVariable {
  name: string;
  description: string;
  default?: string;
  required?: boolean;
}
