--
-- PostgreSQL database dump
--

\restrict 3ifB5qNNaWUevQUjmIlitY0Rh3uxFM7pST1p1715x6FdJEIHFgm9KirLdJY8lK5

-- Dumped from database version 15.18 (Debian 15.18-1.pgdg13+1)
-- Dumped by pg_dump version 15.18 (Debian 15.18-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.templatetags DROP CONSTRAINT IF EXISTS templatetags_template_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templatetags DROP CONSTRAINT IF EXISTS templatetags_tag_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templates DROP CONSTRAINT IF EXISTS templates_group_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templates DROP CONSTRAINT IF EXISTS templates_author_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templatehandlers DROP CONSTRAINT IF EXISTS templatehandlers_template_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templatehandlers DROP CONSTRAINT IF EXISTS templatehandlers_handler_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templatecomponents DROP CONSTRAINT IF EXISTS templatecomponents_template_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templatecomponents DROP CONSTRAINT IF EXISTS templatecomponents_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.handlers DROP CONSTRAINT IF EXISTS handlers_author_id_fkey;
ALTER TABLE IF EXISTS ONLY public.templategroups DROP CONSTRAINT IF EXISTS fk_default_template;
ALTER TABLE IF EXISTS ONLY public.contenttemplategroups DROP CONSTRAINT IF EXISTS contenttemplategroups_group_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contenttemplategroups DROP CONSTRAINT IF EXISTS contenttemplategroups_content_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contenttags DROP CONSTRAINT IF EXISTS contenttags_tag_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contenttags DROP CONSTRAINT IF EXISTS contenttags_content_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contenthandlers DROP CONSTRAINT IF EXISTS contenthandlers_handler_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contenthandlers DROP CONSTRAINT IF EXISTS contenthandlers_content_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contentcomponents DROP CONSTRAINT IF EXISTS contentcomponents_content_id_fkey;
ALTER TABLE IF EXISTS ONLY public.contentcomponents DROP CONSTRAINT IF EXISTS contentcomponents_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.content DROP CONSTRAINT IF EXISTS content_author_id_fkey;
ALTER TABLE IF EXISTS ONLY public.components DROP CONSTRAINT IF EXISTS components_author_id_fkey;
ALTER TABLE IF EXISTS ONLY public.componenthandlers DROP CONSTRAINT IF EXISTS componenthandlers_handler_id_fkey;
ALTER TABLE IF EXISTS ONLY public.componenthandlers DROP CONSTRAINT IF EXISTS componenthandlers_component_id_fkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE IF EXISTS ONLY public.templatetags DROP CONSTRAINT IF EXISTS templatetags_pkey;
ALTER TABLE IF EXISTS ONLY public.templates DROP CONSTRAINT IF EXISTS templates_pkey;
ALTER TABLE IF EXISTS ONLY public.templatehandlers DROP CONSTRAINT IF EXISTS templatehandlers_pkey;
ALTER TABLE IF EXISTS ONLY public.templategroups DROP CONSTRAINT IF EXISTS templategroups_pkey;
ALTER TABLE IF EXISTS ONLY public.templategroups DROP CONSTRAINT IF EXISTS templategroups_name_key;
ALTER TABLE IF EXISTS ONLY public.templatecomponents DROP CONSTRAINT IF EXISTS templatecomponents_pkey;
ALTER TABLE IF EXISTS ONLY public.tags DROP CONSTRAINT IF EXISTS tags_pkey;
ALTER TABLE IF EXISTS ONLY public.tags DROP CONSTRAINT IF EXISTS tags_name_key;
ALTER TABLE IF EXISTS ONLY public.sitesettings DROP CONSTRAINT IF EXISTS sitesettings_pkey;
ALTER TABLE IF EXISTS ONLY public.handlers DROP CONSTRAINT IF EXISTS handlers_pkey;
ALTER TABLE IF EXISTS ONLY public.handlers DROP CONSTRAINT IF EXISTS handlers_name_key;
ALTER TABLE IF EXISTS ONLY public.contenttemplategroups DROP CONSTRAINT IF EXISTS contenttemplategroups_pkey;
ALTER TABLE IF EXISTS ONLY public.contenttags DROP CONSTRAINT IF EXISTS contenttags_pkey;
ALTER TABLE IF EXISTS ONLY public.contenthandlers DROP CONSTRAINT IF EXISTS contenthandlers_pkey;
ALTER TABLE IF EXISTS ONLY public.contentcomponents DROP CONSTRAINT IF EXISTS contentcomponents_pkey;
ALTER TABLE IF EXISTS ONLY public.content DROP CONSTRAINT IF EXISTS content_pkey;
ALTER TABLE IF EXISTS ONLY public.components DROP CONSTRAINT IF EXISTS components_pkey;
ALTER TABLE IF EXISTS ONLY public.components DROP CONSTRAINT IF EXISTS components_name_key;
ALTER TABLE IF EXISTS ONLY public.componenthandlers DROP CONSTRAINT IF EXISTS componenthandlers_pkey;
ALTER TABLE IF EXISTS public.templates ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.templategroups ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.tags ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.handlers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.content ALTER COLUMN id DROP DEFAULT;
ALTER TABLE IF EXISTS public.components ALTER COLUMN id DROP DEFAULT;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.templatetags;
DROP SEQUENCE IF EXISTS public.templates_id_seq;
DROP TABLE IF EXISTS public.templates;
DROP TABLE IF EXISTS public.templatehandlers;
DROP SEQUENCE IF EXISTS public.templategroups_id_seq;
DROP TABLE IF EXISTS public.templategroups;
DROP TABLE IF EXISTS public.templatecomponents;
DROP SEQUENCE IF EXISTS public.tags_id_seq;
DROP TABLE IF EXISTS public.tags;
DROP TABLE IF EXISTS public.sitesettings;
DROP SEQUENCE IF EXISTS public.handlers_id_seq;
DROP TABLE IF EXISTS public.handlers;
DROP TABLE IF EXISTS public.contenttemplategroups;
DROP TABLE IF EXISTS public.contenttags;
DROP TABLE IF EXISTS public.contenthandlers;
DROP TABLE IF EXISTS public.contentcomponents;
DROP SEQUENCE IF EXISTS public.content_id_seq;
DROP TABLE IF EXISTS public.content;
DROP SEQUENCE IF EXISTS public.components_id_seq;
DROP TABLE IF EXISTS public.components;
DROP TABLE IF EXISTS public.componenthandlers;
DROP EXTENSION IF EXISTS pgcrypto;
-- *not* dropping schema, since initdb creates it
--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: componenthandlers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.componenthandlers (
    component_id integer NOT NULL,
    handler_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.components (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    payload jsonb NOT NULL,
    author_id character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: components_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.components_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.components_id_seq OWNED BY public.components.id;


--
-- Name: content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content (
    id integer NOT NULL,
    author_id character varying(255),
    payload jsonb NOT NULL,
    live_date timestamp with time zone,
    is_visible boolean DEFAULT true,
    headers text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: content_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.content_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: content_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.content_id_seq OWNED BY public.content.id;


--
-- Name: contentcomponents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contentcomponents (
    content_id integer NOT NULL,
    component_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: contenthandlers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contenthandlers (
    content_id integer NOT NULL,
    handler_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: contenttags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contenttags (
    content_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: contenttemplategroups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contenttemplategroups (
    content_id integer NOT NULL,
    group_id integer NOT NULL
);


--
-- Name: handlers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.handlers (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    body text NOT NULL,
    author_id character varying(255),
    is_approved boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: handlers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.handlers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: handlers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.handlers_id_seq OWNED BY public.handlers.id;


--
-- Name: sitesettings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sitesettings (
    key character varying(255) NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id integer NOT NULL,
    name character varying(255) NOT NULL
);


--
-- Name: tags_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tags_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tags_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tags_id_seq OWNED BY public.tags.id;


--
-- Name: templatecomponents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templatecomponents (
    template_id integer NOT NULL,
    component_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: templategroups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templategroups (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    default_template_id integer
);


--
-- Name: templategroups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.templategroups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: templategroups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.templategroups_id_seq OWNED BY public.templategroups.id;


--
-- Name: templatehandlers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templatehandlers (
    template_id integer NOT NULL,
    handler_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templates (
    id integer NOT NULL,
    author_id character varying(255),
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    group_id integer
);


--
-- Name: templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.templates_id_seq OWNED BY public.templates.id;


--
-- Name: templatetags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.templatetags (
    template_id integer NOT NULL,
    tag_id integer NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    username character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_admin boolean DEFAULT false,
    is_contributor boolean DEFAULT false,
    is_shadowed boolean DEFAULT false,
    is_trusted_dev boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: components id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components ALTER COLUMN id SET DEFAULT nextval('public.components_id_seq'::regclass);


--
-- Name: content id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content ALTER COLUMN id SET DEFAULT nextval('public.content_id_seq'::regclass);


--
-- Name: handlers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handlers ALTER COLUMN id SET DEFAULT nextval('public.handlers_id_seq'::regclass);


--
-- Name: tags id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags ALTER COLUMN id SET DEFAULT nextval('public.tags_id_seq'::regclass);


--
-- Name: templategroups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templategroups ALTER COLUMN id SET DEFAULT nextval('public.templategroups_id_seq'::regclass);


--
-- Name: templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates ALTER COLUMN id SET DEFAULT nextval('public.templates_id_seq'::regclass);


--
-- Data for Name: componenthandlers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.componenthandlers (component_id, handler_id, created_at, updated_at) FROM stdin;
1	1	2026-05-27 21:54:43.746099+00	2026-05-27 21:54:43.746099+00
1	2	2026-05-27 21:54:43.746099+00	2026-05-27 21:54:43.746099+00
2	3	2026-05-27 22:52:47.319007+00	2026-05-27 22:52:47.319007+00
2	4	2026-05-27 22:52:47.319007+00	2026-05-27 22:52:47.319007+00
2	5	2026-05-27 22:52:47.319007+00	2026-05-27 22:52:47.319007+00
1	6	2026-05-27 22:54:35.723875+00	2026-05-27 22:54:35.723875+00
2	7	2026-05-27 22:52:47.319007+00	2026-05-27 22:52:47.319007+00
2	8	2026-05-27 22:52:47.319007+00	2026-05-27 22:52:47.319007+00
\.


--
-- Data for Name: components; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.components (id, name, payload, author_id, created_at, updated_at) FROM stdin;
1	PreemptEditor	{"css": {"style": {"gap": "10px", "right": "10px", "border": "1px solid #444", "bottom": "10px", "zIndex": "9999", "display": "flex", "padding": "10px", "position": "fixed", "alignItems": "flex-end", "background": "#222", "borderRadius": "5px", "flexDirection": "column"}}, "type": "div", "content": [{"css": {"style": {"gap": "10px", "display": "flex"}}, "type": "div", "content": [{"css": {"style": {"padding": "5px"}}, "type": "input", "props": {"id": "template-tags", "placeholder": "Tags (comma separated)"}}, {"type": "button", "content": "Save", "component": [{"target": "handlers.click", "reference": "EditorSaveHandler"}]}]}, {"css": {"style": {"color": "#0f0", "width": "300px", "margin": "0", "fontSize": "10px", "overflow": "auto", "maxHeight": "200px", "background": "#000"}}, "type": "pre", "props": {"id": "editor-inspector-display"}, "component": [{"target": "content", "reference": "inspectedNodeData"}]}]}	admin	2026-05-27 21:54:43.744909+00	2026-05-27 21:54:43.744909+00
2	LoginComponent	{"css": {"style": {"border": "1px solid #ccc", "padding": "20px", "maxWidth": "300px", "background": "#f9f9f9", "borderRadius": "8px"}, "classes": ["login-component-container"]}, "type": "div", "content": [{"css": {"style": {"gap": "10px", "display": "flex", "marginBottom": "15px"}}, "type": "div", "content": [{"type": "button", "props": {"data-target": "login"}, "content": "Login", "component": [{"target": "handlers.click", "reference": "TabToggleHandler"}]}, {"type": "button", "props": {"data-target": "register"}, "content": "Register", "component": [{"target": "handlers.click", "reference": "TabToggleHandler"}]}]}, {"css": {"style": {"display": "block"}, "classes": ["login-form-wrapper"]}, "type": "div", "content": [{"type": "form", "props": {"action": "#"}, "content": [{"css": {"style": {"width": "100%", "display": "block", "marginBottom": "10px"}}, "type": "input", "props": {"name": "username", "required": "true", "placeholder": "Username"}}, {"css": {"style": {"width": "100%", "display": "block", "marginBottom": "10px"}}, "type": "input", "props": {"name": "password", "type": "password", "required": "true", "placeholder": "Password"}}, {"type": "button", "props": {"type": "submit"}, "content": "Login", "component": [{"target": "handlers.click", "reference": "LoginHandler"}]}]}]}, {"css": {"style": {"display": "none"}, "classes": ["register-form-wrapper"]}, "type": "div", "content": [{"type": "form", "props": {"action": "#"}, "content": [{"css": {"style": {"width": "100%", "display": "block", "marginBottom": "10px"}}, "type": "input", "props": {"name": "username", "required": "true", "placeholder": "Username"}}, {"css": {"style": {"width": "100%", "display": "block", "marginBottom": "10px"}}, "type": "input", "props": {"name": "email", "type": "email", "required": "true", "placeholder": "Email"}}, {"css": {"style": {"width": "100%", "display": "block", "marginBottom": "10px"}}, "type": "input", "props": {"name": "password", "type": "password", "required": "true", "placeholder": "Password"}}, {"type": "button", "props": {"type": "submit"}, "content": "Register", "component": [{"target": "handlers.click", "reference": "RegisterHandler"}]}]}]}, {"css": {"style": {"display": "none", "textAlign": "center"}, "classes": ["logged-in-wrapper"]}, "type": "div", "content": [{"type": "h3", "content": "Welcome"}, {"type": "button", "content": "Logout", "component": [{"target": "handlers.click", "reference": "LogoutHandler"}]}]}], "component": [{"target": "handlers.beforeRender", "reference": "CheckLoginHandler"}]}	admin	2026-05-27 22:52:47.316752+00	2026-05-27 22:52:47.316752+00
\.


--
-- Data for Name: content; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.content (id, author_id, payload, live_date, is_visible, headers, created_at, updated_at) FROM stdin;
1	admin	{"content": [{"css": {"style": {"color": "#fff", "padding": "0.5rem", "marginTop": "1rem", "borderRadius": "4px", "backgroundColor": "#42b883"}}, "type": "div", "content": "This was dynamically placed here!", "placement": {"targetPlacement": ["test-zone"]}}, {"css": {"style": {"color": "#fff", "padding": "0.5rem", "marginTop": "1rem", "borderRadius": "4px", "backgroundColor": "#f06292"}}, "type": "div", "content": "I was looking for a fake zone, so I stayed here.", "placement": {"targetPlacement": ["fake-zone"]}}, {"css": {"style": {"gap": "1rem", "border": "1px solid #444", "display": "flex", "padding": "1rem", "marginTop": "2rem", "alignItems": "flex-start", "borderRadius": "8px"}}, "type": "div", "content": [{"css": {"style": {"width": "40px", "height": "40px", "flexShrink": "0", "borderRadius": "50%"}}, "type": "div", "component": [{"value": null, "target": "css.style.backgroundColor", "reference": "avatarColor"}]}, {"type": "div", "content": [{"css": {"style": {"color": "#42b883", "margin": "0 0 0.5rem 0"}}, "type": "h3", "component": [{"value": null, "target": "content", "reference": "writerName"}]}, {"css": {"style": {"color": "#eee", "margin": "0"}}, "type": "p", "component": [{"value": null, "target": "content", "reference": "commentText"}, {"value": null, "target": "css.style.border", "reference": "missingValue"}]}]}], "component": [{"value": null, "target": "css.style.boxShadow", "reference": "shadowColor"}], "placement": {"targetPlacement": ["comment-zone"]}}, {"css": {"style": {"color": "red", "fontSize": "50px"}}, "type": "div", "content": "This orphaned component should never be rendered!"}], "metadata": {"author": "System Admin", "timestamp": "2026-05-22T00:00:00Z"}, "component": [{"value": "Alice_Engineer", "reference": "writerName"}, {"value": "#9c27b0", "reference": "avatarColor"}, {"value": "This component assembly system is really powerful!", "reference": "commentText"}, {"value": "5px 5px 15px rgba(156, 39, 176, 0.5)", "reference": "shadowColor"}, {"value": "I am never consumed", "reference": "unusedValue"}]}	\N	t	<meta property="og:title" content="Preempt SSR Test" /><meta name="description" content="This is dynamically injected OpenGraph data!" />	2026-05-25 20:12:23.060658+00	2026-05-25 20:12:23.060658+00
\.


--
-- Data for Name: contentcomponents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contentcomponents (content_id, component_id, created_at) FROM stdin;
\.


--
-- Data for Name: contenthandlers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contenthandlers (content_id, handler_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: contenttags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contenttags (content_id, tag_id) FROM stdin;
\.


--
-- Data for Name: contenttemplategroups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.contenttemplategroups (content_id, group_id) FROM stdin;
1	1
\.


--
-- Data for Name: handlers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.handlers (id, name, body, author_id, is_approved, created_at, updated_at) FROM stdin;
1	EditorLoginHandler	\nasync (event, context) => {\n    try {\n      const res = await fetch("/api/login", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ username: "admin", password: "password123" })\n      });\n      if (res.ok) alert("Logged in successfully!");\n      else alert("Login failed");\n    } catch(err) {\n      alert("Error logging in");\n    }\n}\n	admin	t	2026-05-27 21:54:43.739515+00	2026-05-27 21:54:43.739515+00
2	EditorSaveHandler	\nasync (event, context) => {\n    const mode = event.target.closest("[mode]")?.getAttribute("mode") || "template";\n    const exportedData = Preempt.Supervisor.exportRootNode();\n    if (!exportedData) return alert("Nothing to save");\n\n    const tagsInput = document.getElementById("template-tags");\n    const tagsValue = tagsInput ? tagsInput.value.split(",").map(t => t.trim()).filter(t => t) : [];\n\n    const urlParts = window.location.pathname.split("/");\n    const id = urlParts[urlParts.length - 1].split("?")[0];\n    \n    let endpoint = mode === "content" ? `/api/content/${id}` : `/api/template/${id}`;\n\n    try {\n      const res = await fetch(endpoint, {\n        method: "PUT",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ payload: exportedData, tags: tagsValue })\n      });\n      if (res.ok) alert("Saved successfully!");\n      else alert(`Save failed: ${res.status}`);\n    } catch(err) {\n      alert("Error saving");\n    }\n}\n	admin	t	2026-05-27 21:54:43.739515+00	2026-05-27 21:54:43.739515+00
3	LoginHandler	\nasync (event, context) => {\n    event.preventDefault();\n    const form = event.target.closest("form");\n    const username = form.querySelector("[name=username]").value;\n    const password = form.querySelector("[name=password]").value;\n    \n    try {\n      const res = await fetch("/api/login", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ username, password })\n      });\n      if (res.ok) window.location.reload();\n      else alert("Login failed");\n    } catch(err) {\n      alert("Error logging in");\n    }\n}\n	admin	t	2026-05-27 22:52:47.301998+00	2026-05-27 22:52:47.301998+00
4	RegisterHandler	\nasync (event, context) => {\n    event.preventDefault();\n    const form = event.target.closest("form");\n    const username = form.querySelector("[name=username]").value;\n    const email = form.querySelector("[name=email]").value;\n    const password = form.querySelector("[name=password]").value;\n    \n    try {\n      const res = await fetch("/api/register", {\n        method: "POST",\n        headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ username, email, password })\n      });\n      if (res.ok) window.location.reload();\n      else {\n        const errData = await res.json();\n        alert(`Registration failed: ${errData.error || res.status}`);\n      }\n    } catch(err) {\n      alert("Error registering");\n    }\n}\n	admin	t	2026-05-27 22:52:47.301998+00	2026-05-27 22:52:47.301998+00
6	EditorInspectHandler	\nasync (event, context) => {\n    event.stopPropagation();\n    \n    // Read the current node data\n    const nodeDataStr = JSON.stringify(context.node.data, null, 2);\n    \n    // Update the global raw template\n    const template = window.Preempt.templateData;\n    if (!template.component) template.component = [];\n    const existing = template.component.find(c => c.reference === "inspectedNodeData");\n    if (existing) {\n        existing.value = nodeDataStr;\n    } else {\n        template.component.push({ reference: "inspectedNodeData", value: nodeDataStr });\n    }\n    \n    // Trigger pipeline re-render\n    window.Preempt.Supervisor.resetInstantiation();\n    await window.Preempt.Supervisor.process(\n        template, \n        window.Preempt.contentData, \n        window.Preempt.pipelineConfig\n    );\n}\n	admin	t	2026-05-27 22:54:20.573625+00	2026-05-27 22:54:20.573625+00
5	TabToggleHandler	(event, context) => {\n    const targetTab = context.node.data.props["data-target"];\n    const container = context.node.parent.parent;\n    \n    const loginFormNode = container.children[1];\n    const registerFormNode = container.children[2];\n    \n    if (targetTab === "login") {\n        loginFormNode.data.css.style.display = "block";\n        registerFormNode.data.css.style.display = "none";\n    } else {\n        loginFormNode.data.css.style.display = "none";\n        registerFormNode.data.css.style.display = "block";\n    }\n    \n    loginFormNode.hasChangedSinceRender = true;\n    registerFormNode.hasChangedSinceRender = true;\n    loginFormNode.render();\n    registerFormNode.render();\n}	admin	t	2026-05-27 22:52:47.301998+00	2026-05-27 22:52:47.301998+00
7	CheckLoginHandler	\n(context) => {\n    const user = context.supervisor?.userData;\n    console.log("CheckLoginHandler executing, user:", user);\n    if (user) {\n        const container = context.node;\n        const tabToggle = container.children[0];\n        const loginForm = container.children[1];\n        const registerForm = container.children[2];\n        const loggedIn = container.children[3];\n        \n        tabToggle.data.css.style.display = "none";\n        loginForm.data.css.style.display = "none";\n        registerForm.data.css.style.display = "none";\n        loggedIn.data.css.style.display = "block";\n        \n        const usernameSpan = loggedIn.children[0];\n        usernameSpan.data.content = `Welcome, ${user.username}!`;\n        container.hasChangedSinceRender = true;\n    }\n}\n	admin	t	2026-05-27 22:52:47.301998+00	2026-05-27 22:52:47.301998+00
8	LogoutHandler	\nasync (event, context) => {\n    try {\n        const res = await fetch("/api/logout", { method: "POST" });\n        if (res.ok) {\n            window.location.reload();\n        }\n    } catch(e) {\n        console.error(e);\n    }\n}\n	admin	t	2026-05-27 22:52:47.301998+00	2026-05-27 22:52:47.301998+00
\.


--
-- Data for Name: sitesettings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sitesettings (key, value, updated_at) FROM stdin;
default_index_content_id	{"id": 1}	2026-06-01 22:38:02.363471+00
server_config	{"runInstantiation": false, "runAssembly": false, "runPreprocessing": false, "runValidation": false, "runRendering": false, "runPostprocessing": false, "runMonitoring": false}	2026-05-24 02:44:03.963177+00
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tags (id, name) FROM stdin;
1	ssr
2	hydration
3	test
4	ssr-hydrated
5	test-tag
\.


--
-- Data for Name: templatecomponents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.templatecomponents (template_id, component_id, created_at) FROM stdin;
1	2	2026-05-27 22:52:47.321745+00
\.


--
-- Data for Name: templategroups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.templategroups (id, name, default_template_id) FROM stdin;
1	Default Group	1
\.


--
-- Data for Name: templatehandlers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.templatehandlers (template_id, handler_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: templates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.templates (id, author_id, payload, created_at, updated_at, group_id) FROM stdin;
1	admin	{"css": {"style": {"height": "100vh", "display": "flex", "alignItems": "center", "flexDirection": "column", "justifyContent": "center"}, "cssDef": [{"styles": {"fontFamily": "sans-serif", "backgroundColor": "#1a1a1a"}, "selector": ".hello-container"}, {"styles": {"color": "#42b883", "margin": "0", "fontSize": "3rem"}, "selector": "h1.dynamic-title"}], "classes": ["hello-container"]}, "type": "div", "content": [{"type": "div", "component": [{"target": "type", "reference": "LoginComponent"}]}, {"css": {"cssDef": [{"styles": {"color": "#888", "marginTop": "1rem", "fontWeight": "bold"}, "selector": ".dynamic-subtitle"}], "classes": ["dynamic-subtitle"]}, "type": "p", "content": "Rendered dynamically with cssDef styling rules."}, {"css": {}, "type": "img", "props": {"alt": "Missing src image"}}, {"css": {"style": {"color": "#42b883", "marginTop": "2rem", "textDecoration": "none"}}, "type": "a", "props": {"href": "https://example.com"}, "content": "Valid Link"}, {"css": {"style": {"border": "2px dashed #888", "padding": "1rem", "marginTop": "2rem", "borderRadius": "8px"}}, "type": "div", "content": [{"css": {"style": {"color": "#888", "margin": "0"}}, "type": "p", "content": "This is the placement zone."}], "placement": {"placementName": "test-zone"}}, {"css": {"style": {"border": "2px dashed #f06292", "padding": "1rem", "marginTop": "2rem", "minHeight": "50px", "borderRadius": "8px"}}, "type": "div", "content": "This is an empty placement zone.", "placement": {"placementName": "empty-zone"}}, {"css": {}, "type": "div", "placement": {"placementName": "comment-zone"}}], "component": [{"value": "Alice_Engineer", "reference": "writerName"}, {"value": "#9c27b0", "reference": "avatarColor"}, {"value": "This component assembly system is really powerful!", "reference": "commentText"}, {"value": "5px 5px 15px rgba(156, 39, 176, 0.5)", "reference": "shadowColor"}, {"value": "I am never consumed", "reference": "unusedValue"}]}	2026-05-25 20:12:23.058397+00	2026-05-27 23:03:09.987023+00	1
\.


--
-- Data for Name: templatetags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.templatetags (template_id, tag_id) FROM stdin;
1	4
1	5
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (username, email, password_hash, is_admin, is_contributor, is_shadowed, created_at, updated_at) FROM stdin;
admin	admin@preempt.com	$2a$06$uLifkh6itCIWpC1ap5ttLuQfOuihd.4GNq254fViFiR057maiwnem	t	f	f	2026-05-25 20:12:23.054262+00	2026-05-25 20:12:23.054262+00
testadmin	test@test.com	$2a$06$.3D8lyRliDsrRTOC3segfOAFp6M9wZkZSbxO/02fwVUtMc9DSSGde	t	f	f	2026-05-27 23:00:01.101547+00	2026-05-27 23:00:01.101547+00
TestAdmin	testAdmin@example.com	$2a$10$45EUuEA86K76djC/HiLvrO7whyDvTQ5u6tCFp985gLn/KhYijw1Qu	t	f	f	2026-05-29 01:43:54.935977+00	2026-05-29 01:43:54.935977+00
\.


--
-- Name: components_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.components_id_seq', 2, true);


--
-- Name: content_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.content_id_seq', 1, true);


--
-- Name: handlers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.handlers_id_seq', 8, true);


--
-- Name: tags_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tags_id_seq', 5, true);


--
-- Name: templategroups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.templategroups_id_seq', 1, true);


--
-- Name: templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.templates_id_seq', 1, true);


--
-- Name: componenthandlers componenthandlers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.componenthandlers
    ADD CONSTRAINT componenthandlers_pkey PRIMARY KEY (component_id, handler_id);


--
-- Name: components components_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_name_key UNIQUE (name);


--
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (id);


--
-- Name: content content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content
    ADD CONSTRAINT content_pkey PRIMARY KEY (id);


--
-- Name: contentcomponents contentcomponents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contentcomponents
    ADD CONSTRAINT contentcomponents_pkey PRIMARY KEY (content_id, component_id);


--
-- Name: contenthandlers contenthandlers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenthandlers
    ADD CONSTRAINT contenthandlers_pkey PRIMARY KEY (content_id, handler_id);


--
-- Name: contenttags contenttags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenttags
    ADD CONSTRAINT contenttags_pkey PRIMARY KEY (content_id, tag_id);


--
-- Name: contenttemplategroups contenttemplategroups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenttemplategroups
    ADD CONSTRAINT contenttemplategroups_pkey PRIMARY KEY (content_id, group_id);


--
-- Name: handlers handlers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handlers
    ADD CONSTRAINT handlers_name_key UNIQUE (name);


--
-- Name: handlers handlers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handlers
    ADD CONSTRAINT handlers_pkey PRIMARY KEY (id);


--
-- Name: sitesettings sitesettings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitesettings
    ADD CONSTRAINT sitesettings_pkey PRIMARY KEY (key);


--
-- Name: tags tags_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_name_key UNIQUE (name);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: templatecomponents templatecomponents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatecomponents
    ADD CONSTRAINT templatecomponents_pkey PRIMARY KEY (template_id, component_id);


--
-- Name: templategroups templategroups_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templategroups
    ADD CONSTRAINT templategroups_name_key UNIQUE (name);


--
-- Name: templategroups templategroups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templategroups
    ADD CONSTRAINT templategroups_pkey PRIMARY KEY (id);


--
-- Name: templatehandlers templatehandlers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatehandlers
    ADD CONSTRAINT templatehandlers_pkey PRIMARY KEY (template_id, handler_id);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: templatetags templatetags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatetags
    ADD CONSTRAINT templatetags_pkey PRIMARY KEY (template_id, tag_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (username);


--
-- Name: componenthandlers componenthandlers_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.componenthandlers
    ADD CONSTRAINT componenthandlers_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(id) ON DELETE CASCADE;


--
-- Name: componenthandlers componenthandlers_handler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.componenthandlers
    ADD CONSTRAINT componenthandlers_handler_id_fkey FOREIGN KEY (handler_id) REFERENCES public.handlers(id) ON DELETE CASCADE;


--
-- Name: components components_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(username);


--
-- Name: content content_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content
    ADD CONSTRAINT content_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(username);


--
-- Name: contentcomponents contentcomponents_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contentcomponents
    ADD CONSTRAINT contentcomponents_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(id) ON DELETE CASCADE;


--
-- Name: contentcomponents contentcomponents_content_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contentcomponents
    ADD CONSTRAINT contentcomponents_content_id_fkey FOREIGN KEY (content_id) REFERENCES public.content(id) ON DELETE CASCADE;


--
-- Name: contenthandlers contenthandlers_content_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenthandlers
    ADD CONSTRAINT contenthandlers_content_id_fkey FOREIGN KEY (content_id) REFERENCES public.content(id) ON DELETE CASCADE;


--
-- Name: contenthandlers contenthandlers_handler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenthandlers
    ADD CONSTRAINT contenthandlers_handler_id_fkey FOREIGN KEY (handler_id) REFERENCES public.handlers(id) ON DELETE CASCADE;


--
-- Name: contenttags contenttags_content_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenttags
    ADD CONSTRAINT contenttags_content_id_fkey FOREIGN KEY (content_id) REFERENCES public.content(id) ON DELETE CASCADE;


--
-- Name: contenttags contenttags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenttags
    ADD CONSTRAINT contenttags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: contenttemplategroups contenttemplategroups_content_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenttemplategroups
    ADD CONSTRAINT contenttemplategroups_content_id_fkey FOREIGN KEY (content_id) REFERENCES public.content(id) ON DELETE CASCADE;


--
-- Name: contenttemplategroups contenttemplategroups_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contenttemplategroups
    ADD CONSTRAINT contenttemplategroups_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.templategroups(id) ON DELETE CASCADE;


--
-- Name: templategroups fk_default_template; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templategroups
    ADD CONSTRAINT fk_default_template FOREIGN KEY (default_template_id) REFERENCES public.templates(id) ON DELETE SET NULL;


--
-- Name: handlers handlers_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.handlers
    ADD CONSTRAINT handlers_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(username);


--
-- Name: templatecomponents templatecomponents_component_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatecomponents
    ADD CONSTRAINT templatecomponents_component_id_fkey FOREIGN KEY (component_id) REFERENCES public.components(id) ON DELETE CASCADE;


--
-- Name: templatecomponents templatecomponents_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatecomponents
    ADD CONSTRAINT templatecomponents_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;


--
-- Name: templatehandlers templatehandlers_handler_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatehandlers
    ADD CONSTRAINT templatehandlers_handler_id_fkey FOREIGN KEY (handler_id) REFERENCES public.handlers(id) ON DELETE CASCADE;


--
-- Name: templatehandlers templatehandlers_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatehandlers
    ADD CONSTRAINT templatehandlers_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;


--
-- Name: templates templates_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(username);


--
-- Name: templates templates_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.templategroups(id) ON DELETE CASCADE;


--
-- Name: templatetags templatetags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatetags
    ADD CONSTRAINT templatetags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: templatetags templatetags_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.templatetags
    ADD CONSTRAINT templatetags_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 3ifB5qNNaWUevQUjmIlitY0Rh3uxFM7pST1p1715x6FdJEIHFgm9KirLdJY8lK5

