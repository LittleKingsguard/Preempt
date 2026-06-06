import json
import re
import sys

def main():
    with open('login_component_payload.json', 'r') as f:
        login_component = json.load(f)
    login_payload_str = json.dumps(login_component).replace('\\', '\\\\').replace('\t', '\\t')

    with open('server/seed.sql', 'r') as f:
        lines = f.readlines()

    # Find where to replace LoginComponent (id=2 in components)
    for i, line in enumerate(lines):
        if line.startswith('2\tLoginComponent\t'):
            parts = line.split('\t')
            # <ID> \t <Name> \t <Payload> \t <Author> \t <Created> \t <Updated> \t <Original_id> \t <ChangeBatch> \t <is_approved>
            parts[2] = login_payload_str
            lines[i] = '\t'.join(parts)
            break

    handlers = {
        'LoginHandler': r"""
async (event, context) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const username = form.querySelector("[name=username]").value;
    const password = form.querySelector("[name=password]").value;
    
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "2fa_required" || data.status === "verification_required") {
            localStorage.setItem('preempt_login_username', data.username);
            
            let container = context.node;
            while (container && !(container.data.css?.classes || []).includes("login-component-container")) {
                container = container.parent;
            }
            if (!container) container = context.node.parent.parent;
            
            const tabToggle = container.children[0];
            const loginForm = container.findNode({classes: ["login-form-wrapper"]});
            const twoFaForm = container.findNode({classes: ["2fa-form-wrapper"]});
            const verifyEmailForm = container.findNode({classes: ["verify-form-wrapper"]});
            
            if (tabToggle) tabToggle.data.css.style.display = "none";
            if (loginForm) loginForm.data.css.style.display = "none";
            
            if (data.status === "2fa_required" && twoFaForm) {
                twoFaForm.data.css.style.display = "block";
                twoFaForm.hasChangedSinceRender = true;
                twoFaForm.render();
            } else if (data.status === "verification_required" && verifyEmailForm) {
                verifyEmailForm.data.css.style.display = "block";
                verifyEmailForm.hasChangedSinceRender = true;
                verifyEmailForm.render();
            }
            if (tabToggle) { tabToggle.hasChangedSinceRender = true; tabToggle.render(); }
            if (loginForm) { loginForm.hasChangedSinceRender = true; loginForm.render(); }
        } else {
            window.location.reload();
        }
      } else {
          const errData = await res.json().catch(() => ({}));
          alert(`Login failed: ${errData.error || res.status}`);
      }
    } catch(err) {
      alert("Error logging in");
    }
}
""",
        'RegisterHandler': r"""
async (event, context) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const username = form.querySelector("[name=username]").value;
    const email = form.querySelector("[name=email]").value;
    const password = form.querySelector("[name=password]").value;
    
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "verification_required") {
            localStorage.setItem('preempt_login_username', data.username);
            
            let container = context.node;
            while (container && !(container.data.css?.classes || []).includes("login-component-container")) {
                container = container.parent;
            }
            if (!container) container = context.node.parent.parent;
            
            const tabToggle = container.children[0];
            const registerForm = container.findNode({classes: ["register-form-wrapper"]});
            const verifyEmailForm = container.findNode({classes: ["verify-form-wrapper"]});
            
            if (tabToggle) tabToggle.data.css.style.display = "none";
            if (registerForm) registerForm.data.css.style.display = "none";
            if (verifyEmailForm) verifyEmailForm.data.css.style.display = "block";
            
            if (tabToggle) tabToggle.hasChangedSinceRender = true;
            if (registerForm) registerForm.hasChangedSinceRender = true;
            if (verifyEmailForm) verifyEmailForm.hasChangedSinceRender = true;
            
            if (tabToggle) tabToggle.render();
            if (registerForm) registerForm.render();
            if (verifyEmailForm) verifyEmailForm.render();
        } else {
            window.location.reload();
        }
      } else {
        const err = await res.json();
        alert(`Register failed: ${err.error || res.status}`);
      }
    } catch(err) {
      alert("Error registering");
    }
}
""",
        'TabToggleHandler': r"""
(event, context) => {
    const targetTab = context.node.data.props["data-target"];
    
    // Traverse up to find the main container
    let container = context.node;
    while (container && !(container.data.css?.classes || []).includes("login-component-container")) {
        container = container.parent;
    }
    if (!container) container = context.node.parent.parent; // fallback
    
    const loginFormNode = container.findNode({classes: ["login-form-wrapper"]});
    const registerFormNode = container.findNode({classes: ["register-form-wrapper"]});
    const forgotFormNode = container.findNode({classes: ["forgot-form-wrapper"]});
    const twoFaFormNode = container.findNode({classes: ["2fa-form-wrapper"]});
    const verifyEmailFormNode = container.children[6];
    
    [loginFormNode, registerFormNode, forgotFormNode, twoFaFormNode, verifyEmailFormNode].forEach(node => {
        if(node) {
            node.data.css.style.display = "none";
            node.hasChangedSinceRender = true;
        }
    });
    
    if (targetTab === "login") {
        if (loginFormNode) loginFormNode.data.css.style.display = "block";
    } else if (targetTab === "register") {
        if (registerFormNode) registerFormNode.data.css.style.display = "block";
    } else if (targetTab === "forgot") {
        if (forgotFormNode) forgotFormNode.data.css.style.display = "block";
    }
    
    [loginFormNode, registerFormNode, forgotFormNode, twoFaFormNode, verifyEmailFormNode].forEach(node => {
        if(node) node.render();
    });
}
""",
        'CheckLoginHandler': r"""
(context) => {
    const container = context.node;
    const tabToggle = container.children[0];
    const loginForm = container.findNode({classes: ["login-form-wrapper"]});
    const registerForm = container.findNode({classes: ["register-form-wrapper"]});
    const forgotForm = container.findNode({classes: ["forgot-form-wrapper"]});
    const twoFaForm = container.findNode({classes: ["2fa-form-wrapper"]});
    const verifyEmailForm = container.findNode({classes: ["verify-form-wrapper"]});
    const resetForm = container.findNode({classes: ["reset-form-wrapper"]});
    const loggedIn = container.findNode({classes: ["logged-in-wrapper"]});
    
    const isResetPage = window.location.pathname === "/reset-password";
    
    if (isResetPage) {
        if (tabToggle) tabToggle.data.css.style.display = "none";
        if (loginForm) loginForm.data.css.style.display = "none";
        if (registerForm) registerForm.data.css.style.display = "none";
        if (forgotForm) forgotForm.data.css.style.display = "none";
        if (twoFaForm) twoFaForm.data.css.style.display = "none";
        if (verifyEmailForm) verifyEmailForm.data.css.style.display = "none";
        if (loggedIn) loggedIn.data.css.style.display = "none";
        if (resetForm) {
            resetForm.data.css.style.display = "block";
            resetForm.hasChangedSinceRender = true;
        }
        container.hasChangedSinceRender = true;
        return; // stop here
    }
    
    const user = context.supervisor?.userData;
    if (user) {
        if (tabToggle) tabToggle.data.css.style.display = "none";
        if (loginForm) loginForm.data.css.style.display = "none";
        if (registerForm) registerForm.data.css.style.display = "none";
        if (forgotForm) forgotForm.data.css.style.display = "none";
        if (twoFaForm) twoFaForm.data.css.style.display = "none";
        if (verifyEmailForm) verifyEmailForm.data.css.style.display = "none";
        if (resetForm) resetForm.data.css.style.display = "none";
        
        if (loggedIn) {
            loggedIn.data.css.style.display = "block";
            const usernameSpan = loggedIn.children[0];
            if (usernameSpan) usernameSpan.data.content = `Welcome, ${user.username}!`;
        }
        container.hasChangedSinceRender = true;
    }
}
"""
    }
    
    # Missing Handlers to append
    missing_handlers = {
        'Verify2FAHandler': r"""
async (event, context) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const code = form.querySelector("[name=code]").value;
    const username = localStorage.getItem('preempt_login_username') || form.querySelector("[name=username]").value;
    
    try {
      const res = await fetch("/api/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code })
      });
      if (res.ok) window.location.reload();
      else {
        const err = await res.json();
        alert(`2FA failed: ${err.error || res.status}`);
      }
    } catch(err) {
      alert("Error verifying 2FA");
    }
}
""",
        'VerifyEmailHandler': r"""
async (event, context) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const code = form.querySelector("[name=code]").value;
    const username = localStorage.getItem('preempt_login_username') || form.querySelector("[name=username]").value;
    
    try {
      const res = await fetch("/api/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, code })
      });
      if (res.ok) window.location.reload();
      else {
        const err = await res.json();
        alert(`Email verification failed: ${err.error || res.status}`);
      }
    } catch(err) {
      alert("Error verifying email");
    }
}
""",
        'ForgotPasswordHandler': r"""
async (event, context) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const email = form.querySelector("[name=email]").value;
    
    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      if (res.ok) {
        alert("Reset link sent if email exists.");
      } else {
        const err = await res.json();
        alert(`Forgot password failed: ${err.error || res.status}`);
      }
    } catch(err) {
      alert("Error sending reset link");
    }
}
""",
        'ResetPasswordHandler': r"""
async (event, context) => {
    event.preventDefault();
    const form = event.target.closest("form");
    const new_password = form.querySelector("[name=new_password]").value;
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const username = urlParams.get('username');
    
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, token, new_password })
      });
      if (res.ok) {
        alert("Password updated successfully!");
        window.location.href = "/";
      } else {
        const err = await res.json();
        alert(`Reset failed: ${err.error || res.status}`);
      }
    } catch(err) {
      alert("Error resetting password");
    }
}
"""
    }

    # Replace existing handlers
    for i, line in enumerate(lines):
        if line.startswith('3\tLoginHandler\t'):
            parts = line.split('\t')
            parts[2] = handlers['LoginHandler'].replace('\n', '\\n')
            lines[i] = '\t'.join(parts)
        elif line.startswith('4\tRegisterHandler\t'):
            parts = line.split('\t')
            parts[2] = handlers['RegisterHandler'].replace('\n', '\\n')
            lines[i] = '\t'.join(parts)
        elif line.startswith('5\tTabToggleHandler\t'):
            parts = line.split('\t')
            parts[2] = handlers['TabToggleHandler'].replace('\n', '\\n')
            lines[i] = '\t'.join(parts)
        elif line.startswith('7\tCheckLoginHandler\t'):
            parts = line.split('\t')
            parts[2] = handlers['CheckLoginHandler'].replace('\n', '\\n')
            lines[i] = '\t'.join(parts)
            
    # Append new handlers before the end of handlers table dump
    handlers_insert_idx = None
    already_has_new = False
    for i, line in enumerate(lines):
        if line.startswith('18\tForgotPasswordHandler\t'):
            already_has_new = True
        if line.strip() == '\\.' and '15\tAdminFetchBatchesHandler\t' in lines[i-1]:
            handlers_insert_idx = i
            break
            
    handlers_data = (
        f"16\tVerify2FAHandler\t{missing_handlers['Verify2FAHandler'].replace(chr(10), r'\\n')}\tadmin\tt\t2026-05-27 22:52:47.301998+00\t2026-05-27 22:52:47.301998+00\t\\N\t\\N\n"
        f"17\tVerifyEmailHandler\t{missing_handlers['VerifyEmailHandler'].replace(chr(10), r'\\n')}\tadmin\tt\t2026-05-27 22:52:47.301998+00\t2026-05-27 22:52:47.301998+00\t\\N\t\\N\n"
        f"18\tForgotPasswordHandler\t{missing_handlers['ForgotPasswordHandler'].replace(chr(10), r'\\n')}\tadmin\tt\t2026-05-27 22:52:47.301998+00\t2026-05-27 22:52:47.301998+00\t\\N\t\\N\n"
        f"19\tResetPasswordHandler\t{missing_handlers['ResetPasswordHandler'].replace(chr(10), r'\\n')}\tadmin\tt\t2026-05-27 22:52:47.301998+00\t2026-05-27 22:52:47.301998+00\t\\N\t\\N\n"
    )

    if handlers_insert_idx is not None and not already_has_new:
        lines.insert(handlers_insert_idx, handlers_data)

    # Update the sequence
    for i, line in enumerate(lines):
        if "SELECT pg_catalog.setval('public.handlers_id_seq'" in line:
            lines[i] = "SELECT pg_catalog.setval('public.handlers_id_seq', 19, true);\n"

    # Add to componenthandlers
    ch_insert_idx = None
    already_has_ch = False
    for i, line in enumerate(lines):
        if line.startswith('2\t18\t'):
            already_has_ch = True
        if line.strip() == '\\.' and '2\t8\t' in lines[i-1]:
            ch_insert_idx = i
            break
            
    if ch_insert_idx is not None and not already_has_ch:
        ch_data = (
            "2\t16\t2026-05-27 22:52:47.319007+00\t2026-05-27 22:52:47.319007+00\n"
            "2\t17\t2026-05-27 22:52:47.319007+00\t2026-05-27 22:52:47.319007+00\n"
            "2\t18\t2026-05-27 22:52:47.319007+00\t2026-05-27 22:52:47.319007+00\n"
            "2\t19\t2026-05-27 22:52:47.319007+00\t2026-05-27 22:52:47.319007+00\n"
        )
        lines.insert(ch_insert_idx, ch_data)

    with open('server/seed.sql', 'w') as f:
        f.writelines(lines)

if __name__ == "__main__":
    main()
