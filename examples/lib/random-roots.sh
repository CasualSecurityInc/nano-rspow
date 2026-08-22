generate_random_roots() {
  local count="${1:?root count is required}"
  local i

  for ((i = 0; i < count; i++)); do
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n' | tr '[:lower:]' '[:upper:]'
    printf '\n'
  done
}
