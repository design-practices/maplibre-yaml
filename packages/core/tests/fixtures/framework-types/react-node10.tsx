// moduleResolution "node" (node10) ignores package.json `exports`; the
// `typesVersions` entry is what resolves `@maplibre-yaml/core/react` there.
export const SrcMap = () => <ml-map src="/map.yaml" />;

// @ts-expect-error src is a string
export const Wrong = () => <ml-map src={5} />;
