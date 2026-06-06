with open('server/seed.sql', 'r') as f:
    lines = f.readlines()

handlers_insert_idx = None
already_has_19 = False
for i, line in enumerate(lines):
    if line.startswith('19\tResetPasswordHandler\t'):
        already_has_19 = True
    if line.strip() == '\\.' and '18\tForgotPasswordHandler\t' in lines[i-1]:
        handlers_insert_idx = i
        break

if handlers_insert_idx is not None and not already_has_19:
    handlers_data = "19\tResetPasswordHandler\tasync (event, context) => {\\n    event.preventDefault();\\n    const form = event.target.closest(\"form\");\\n    const new_password = form.querySelector(\"[name=new_password]\").value;\\n    const urlParams = new URLSearchParams(window.location.search);\\n    const token = urlParams.get('token');\\n    const username = urlParams.get('username');\\n    \\n    try {\\n      const res = await fetch(\"/api/reset-password\", {\\n        method: \"POST\",\\n        headers: { \"Content-Type\": \"application/json\" },\\n        body: JSON.stringify({ username, token, new_password })\\n      });\\n      if (res.ok) {\\n        alert(\"Password updated successfully!\");\\n        window.location.href = \"/\";\\n      } else {\\n        const err = await res.json();\\n        alert(`Reset failed: ${err.error || res.status}`);\\n      }\\n    } catch(err) {\\n      alert(\"Error resetting password\");\\n    }\\n}\tadmin\tt\t2026-05-27 22:52:47.301998+00\t2026-05-27 22:52:47.301998+00\t\\N\t\\N\n"
    lines.insert(handlers_insert_idx, handlers_data)
    with open('server/seed.sql', 'w') as f:
        f.writelines(lines)
