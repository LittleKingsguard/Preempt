import json

with open('login_component_payload.json', 'r') as f:
    data = json.load(f)

for child in data['content']:
    if child.get('content') and isinstance(child['content'], list) and child['content'][0].get('content') == "Verify Your Email":
        if 'css' not in child:
            child['css'] = {}
        if 'classes' not in child['css']:
            child['css']['classes'] = []
        if 'verify-form-wrapper' not in child['css']['classes']:
            child['css']['classes'].append('verify-form-wrapper')

reset_wrapper = {
    "css": {
        "style": {"display": "none"},
        "classes": ["reset-form-wrapper"]
    },
    "type": "div",
    "content": [
        {
            "css": {"style": {"marginBottom": "15px"}},
            "type": "h2",
            "content": "Reset Password"
        },
        {
            "type": "form",
            "props": {"action": "#"},
            "content": [
                {
                    "css": {"style": {"width": "100%", "display": "block", "marginBottom": "10px"}},
                    "type": "input",
                    "props": {
                        "name": "new_password",
                        "type": "password",
                        "required": "true",
                        "placeholder": "New Password"
                    }
                },
                {
                    "type": "button",
                    "props": {"type": "submit"},
                    "content": "Update Password",
                    "component": [
                        {"target": "handlers.click", "reference": "ResetPasswordHandler"}
                    ]
                }
            ]
        }
    ]
}

already_has_reset = any("reset-form-wrapper" in c.get('css', {}).get('classes', []) for c in data['content'])
if not already_has_reset:
    data['content'].append(reset_wrapper)

with open('login_component_payload.json', 'w') as f:
    json.dump(data, f)
