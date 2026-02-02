export function HomePage() {
  const hkSkyline = `
                                        ||
                                       |  |
                                      |    |
                                     |  ||  |
                                    |   ||   |
                                   |    ||    |
                      ||          |     ||     |
                     |  |        |      ||      |
                    |    |      |       ||       |
           ||      |  ||  |    |        ||        |
          |  |    |   ||   |  |         ||         |
    ||   |    |  |    ||    ||          ||          |
   |  | |  ||  ||     ||     |          ||          |
  |    ||  ||  ||     ||     |    ||    ||    ||    |
 |  ||  |  ||  ||     ||     |   |  |   ||   |  |   |
|   ||   | ||  ||     ||     |  |    |  ||  |    |  |
    ||   | ||  ||     ||     | |  ||  | || |  ||  | |
    ||   | ||  ||     ||     ||   ||   |||   ||   |||
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
              V  I  C  T  O  R  I  A    H  A  R  B  O  U  R
`

  return (
    <div>
      <div style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
          LX Software
        </h1>
        <p
          className="text-muted"
          style={{ fontSize: '1.1rem', maxWidth: '600px', lineHeight: '1.8' }}
        >
          Building modern web applications and public presence solutions for
          teams in Hong Kong and beyond.
        </p>
      </div>

      <div className="ascii-art" style={{ marginTop: '3rem' }}>
        {hkSkyline}
      </div>

      <div
        className="text-dim"
        style={{ marginTop: '2rem', fontSize: '0.875rem' }}
      >
        &gt; Navigate using the menu on the left
        <span className="terminal-cursor">_</span>
      </div>
    </div>
  )
}
