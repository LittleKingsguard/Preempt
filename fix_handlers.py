import json

def escape_sql_string(s):
    return "'" + s.replace("'", "''") + "'"

handlers = {
    "AdminFetchContentHandler": """
async (context) => {
    if (context.supervisor.adminContentFetched) return;
    try {
        const res = await fetch("/api/content");
        if (res.ok) {
            const contents = await res.json();
            context.supervisor.adminContentFetched = true;
            
            const container = context.node;
            // Clear children
            [...container.children].forEach(c => c.delete());
            container.children = [];
            
            container.addChild({ type: "h3", content: "Existing Content" });
            
            for (const c of contents) {
                container.addChild({
                    type: "div",
                    css: { style: { border: "1px solid #ccc", padding: "10px", margin: "10px 0", display: "flex", gap: "10px" } },
                    content: [
                        { type: "span", content: `ID: ${c.id} | Author: ${c.author_id} | Vis: ${c.is_visible} | Live: ${c.live_date}` },
                        { type: "button", content: "Toggle Vis", props: { "data-id": c.id, "data-vis": c.is_visible, "data-payload": JSON.stringify(c.payload) }, component: [{ target: "handlers.click", reference: "AdminToggleContentVisHandler" }] },
                        { type: "button", content: "Delete", props: { "data-id": c.id }, component: [{ target: "handlers.click", reference: "AdminDeleteContentHandler" }] }
                    ]
                });
            }
        }
    } catch(err) {
        console.error(err);
    }
}
""",
    "AdminFetchUsersHandler": """
async (context) => {
    if (context.supervisor.adminUsersFetched) return;
    try {
        const res = await fetch("/api/admin/users");
        if (res.ok) {
            const users = await res.json();
            context.supervisor.adminUsersFetched = true;
            
            const container = context.node;
            [...container.children].forEach(c => c.delete());
            container.children = [];
            
            container.addChild({ type: "h3", content: "Users" });
            
            for (const u of users) {
                container.addChild({
                    type: "div",
                    css: { style: { border: "1px solid #ccc", padding: "10px", margin: "10px 0", display: "flex", gap: "10px" } },
                    content: [
                        { type: "span", content: `${u.username} | Admin: ${u.is_admin} | Contrib: ${u.is_contributor}` },
                        { type: "button", content: "Toggle Contrib", props: { "data-username": u.username, "data-val": !u.is_contributor }, component: [{ target: "handlers.click", reference: "AdminUpdateUserRoleHandler" }] }
                    ]
                });
            }
        }
    } catch(err) {
        console.error(err);
    }
}
""",
    "AdminFetchBatchesHandler": """
async (context) => {
    if (context.supervisor.adminBatchesFetched) return;
    try {
        const res = await fetch("/api/mcp/admin/change-batches");
        if (res.ok) {
            const data = await res.json();
            context.supervisor.adminBatchesFetched = true;
            
            const container = context.node;
            [...container.children].forEach(c => c.delete());
            container.children = [];
            
            container.addChild({ type: "h3", content: "Pending MCP Batches" });
            
            if (!data.batches || data.batches.length === 0) {
                container.addChild({ type: "p", content: "No pending batches." });
            } else {
                for (const b of data.batches) {
                    container.addChild({
                        type: "div",
                        css: { style: { border: "1px solid #ccc", padding: "10px", margin: "10px 0" } },
                        content: [
                            { type: "p", content: `Batch ${b.id} by ${b.author_id}: ${b.description}` },
                            { type: "button", content: "Approve", props: { "data-id": b.id }, component: [{ target: "handlers.click", reference: "AdminApproveBatchHandler" }] },
                            { type: "button", content: "Reject", props: { "data-id": b.id }, component: [{ target: "handlers.click", reference: "AdminRejectBatchHandler" }] }
                        ]
                    });
                }
            }
        }
    } catch(err) {
        console.error(err);
    }
}
""",
    "AdminFetchHandlersHandler": """
async (context) => {
    if (context.supervisor.adminHandlersFetched) return;
    try {
        const res = await fetch("/api/handlers");
        if (res.ok) {
            const data = await res.json();
            context.supervisor.adminHandlersFetched = true;
            
            const container = context.node;
            [...container.children].forEach(c => c.delete());
            container.children = [];
            
            container.addChild({ type: "h3", content: "Pending Handlers" });
            
            const pending = data.filter(h => !h.is_approved);
            if (pending.length === 0) {
                container.addChild({ type: "p", content: "No pending handlers." });
            } else {
                for (const h of pending) {
                    container.addChild({
                        type: "div",
                        css: { style: { border: "1px solid #ccc", padding: "10px", margin: "10px 0" } },
                        content: [
                            { type: "p", content: `Handler ${h.id}: ${h.name} by ${h.author_id}` },
                            { type: "pre", content: h.body, css: { style: { background: "#eee", padding: "10px", overflow: "auto" } } },
                            { type: "button", content: "Approve", props: { "data-id": h.id }, component: [{ target: "handlers.click", reference: "AdminApproveHandlerHandler" }] }
                        ]
                    });
                }
            }
        }
    } catch(err) {
        console.error(err);
    }
}
""",
    "AdminApproveBatchHandler": """
async (event, context) => {
    const id = context.node.data.props["data-id"];
    try {
        const res = await fetch(`/api/mcp/admin/change-batches/${id}/approve`, { method: "POST" });
        if (res.ok) window.location.reload();
        else alert("Approve failed");
    } catch(err) {
        alert("Error approving");
    }
}
""",
    "AdminRejectBatchHandler": """
async (event, context) => {
    const id = context.node.data.props["data-id"];
    try {
        const res = await fetch(`/api/mcp/admin/change-batches/${id}/reject`, { method: "POST" });
        if (res.ok) window.location.reload();
        else alert("Reject failed");
    } catch(err) {
        alert("Error rejecting");
    }
}
"""
}

sql = []
for h_name, h_body in handlers.items():
    sql.append(f"UPDATE Handlers SET body = {escape_sql_string(h_body)} WHERE name = '{h_name}';")

with open("fix_handlers.sql", "w") as f:
    f.write("\n".join(sql))
print("SQL generated")
