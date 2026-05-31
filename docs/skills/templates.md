# Preempt Skill: Templates

## Context
In Preempt, a **Template** represents the structural foundation of a page. Technically, a Template is just the root `Node` of the virtual DOM tree. It defines the layout, base styling, and logical placements where dynamic content will be injected during the pipeline's assembly stage.

## Creating a Template
Templates are defined as JSON structures matching the `NodeData` schema. A typical template consists of a top-level container, a header, a main content area, and a footer.

Example Template:
```json
{
  "type": "div",
  "props": {
    "className": "page-layout"
  },
  "content": [
    {
      "type": "header",
      "content": "My Site Header"
    },
    {
      "type": "main",
      "placement": {
        "placementName": "main-content"
      }
    },
    {
      "type": "footer",
      "content": "Copyright 2026"
    }
  ]
}
```

## Modifying Templates
Because templates are stored as JSON in the database, modifying a template requires either:
1. **Database update**: Using the Preempt Editor or an Admin Dashboard to issue a `PUT /api/template/:id` request with the updated JSON payload.
2. **Dynamic modification via Handlers**: Injecting a mid-stage pipeline handler (like `afterInstantiate` or `beforeAssembly`) that programmatically mutates the root node before the DOM is built.

### Structural vs. Content Edits
- **Structural edits**: Changing layouts, adding permanent sidebars, or modifying the base layout grid should be done by updating the Template payload.
- **Content edits**: Data unique to a single page (like the text of a blog post) should not be baked into the template. Instead, they should be stored in the `Content` payload and dynamically injected into the template using **Placements**.
