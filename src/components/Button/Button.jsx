import './Button.css'

function Button({ children, variant = 'primary', loading = false, ...props }) {
  return (
    <button
      className={`btn btn-${variant}`}
      disabled={loading || props.disabled}
      aria-busy={loading}
      {...props}
    >
      {loading ? 'Please wait...' : children}
    </button>
  )
}

export default Button
