async (event, context) => {
  console.log("Executing handler: onDBLoad_directory");
  try {
    const searchParams = context.node.props?.search || { tags: ['blog'] };
    
    let articles = [];
    if (context.supervisor && context.supervisor.serverApi) {
      articles = await context.supervisor.serverApi.getLatestContent(undefined, searchParams);
    } else {
      const queryParams = new URLSearchParams();
      if (searchParams.tags) {
        const tagsStr = Array.isArray(searchParams.tags) ? searchParams.tags.join(',') : searchParams.tags;
        queryParams.set('tags', tagsStr);
      }
      if (searchParams.author) queryParams.set('author', searchParams.author);
      if (searchParams.limit) queryParams.set('limit', searchParams.limit);
      if (searchParams.offset) queryParams.set('offset', searchParams.offset);

      const res = await fetch(`/api/content?${queryParams.toString()}`);
      if (res.ok) {
        articles = await res.json();
      }
    }
      const listNode = context.node.findNode({ props: { id: "directory-list" } });
      if (listNode) {
        listNode.children = [];
        listNode.content = [];
        
        if (articles.length === 0) {
          listNode.addChild({ type: "p", content: "No articles found." });
        } else {
          articles.forEach(article => {
            listNode.addChild({
              type: "div",
              css: { style: { padding: "1rem", border: "1px solid #ccc", borderRadius: "4px" } },
              content: [
                { type: "h3", content: "Article " + article.id, css: {style: {margin: "0 0 0.5rem 0"}} },
                { type: "a", props: { href: "/article/" + article.id }, content: "Read More" }
              ]
            });
          });
        }
        listNode.render();
      }
  } catch (err) {
    console.error("Error fetching directory:", err);
  }
}
