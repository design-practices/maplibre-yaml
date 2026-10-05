// React 18 only (@types/react 18): React 18 sets unknown props on custom
// elements as ATTRIBUTES, so an object `config` would arrive as
// "[object Object]". The typings turn that runtime bug into a type error.
const doc = { type: "map", id: "m", layers: [] };

// @ts-expect-error React 18 needs JSON.stringify(config)
export const ObjectConfig = () => <ml-map config={doc} />;

export const JsonConfig = () => <ml-map config={JSON.stringify(doc)} />;
