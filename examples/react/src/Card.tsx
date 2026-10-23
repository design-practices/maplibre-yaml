import type { ReactNode } from "react";

/** A titled demo card. `wide` spans both grid columns. */
export function Card(props: {
  id: string;
  title: string;
  lede: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={props.id} className={props.wide ? "card wide" : "card"}>
      <h2>{props.title}</h2>
      <p className="lede">{props.lede}</p>
      {props.children}
    </section>
  );
}
