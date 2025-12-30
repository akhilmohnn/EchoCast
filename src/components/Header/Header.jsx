import './Header.css'

function Header() {
  return (
    <header className="header">
      <div className="logo">
        <span className="logo-icon">◉</span>
        <span className="logo-text">EchoCast</span>
      </div>
      <nav className="nav">
        <a href="#about" className="nav-link">About</a>
      </nav>
    </header>
  )
}

export default Header
