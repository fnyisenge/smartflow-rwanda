export default function ComingSoon({ title, day, reqs, text }) {
  return (
    <div className="page">
      <section className="card coming">
        <span className="badge" style={{ background: "#5b6b7f" }}>Planned for {day}</span>
        <h1>{title}</h1>
        <p>{text}</p>
        <p className="muted small">Covers: {reqs}</p>
      </section>
    </div>
  );
}
