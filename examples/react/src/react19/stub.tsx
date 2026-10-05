// What the React 18 build renders in place of the React 19 panel.
export function React19Panel() {
  return (
    <p className="note" data-testid="r19-stub">
      React 18 sets unknown props on custom elements as <em>attributes</em> and
      ignores <code>onml-map:*</code> props, so this panel needs React 19. On
      React 18 pass <code>config</code> as a JSON string and listen through a
      ref, as the other maps on this page do. The typings enforce it: an object{" "}
      <code>config</code> is a type error against <code>@types/react</code> 18.
    </p>
  );
}
