import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { action } = body;
    const store = getStore({ name: "sessionzero-store", consistency: "strong" });

    if (action === "load") {
      const [products, orders, users, settings] = await Promise.all([
        store.get("products", { type: "json" }),
        store.get("orders", { type: "json" }),
        store.get("users", { type: "json" }),
        store.get("settings", { type: "json" }),
      ]);

      return Response.json({
        products: products || null,
        orders: orders || null,
        users: users || null,
        settings: settings || null,
      });
    }

    if (action === "save") {
      const promises = [];
      if (body.products !== null && body.products !== undefined) {
        promises.push(store.setJSON("products", body.products));
      }
      if (body.orders !== null && body.orders !== undefined) {
        promises.push(store.setJSON("orders", body.orders));
      }
      if (body.users !== null && body.users !== undefined) {
        // Strip password hashes before storing — only save safe user fields
        const safeUsers = body.users.map(u => ({
          id: u.id,
          name: u.name,
          email: u.email,
          passwordHash: u.passwordHash,
          salt: u.salt,
          createdAt: u.createdAt,
        }));
        promises.push(store.setJSON("users", safeUsers));
      }
      if (body.settings !== null && body.settings !== undefined) {
        promises.push(store.setJSON("settings", body.settings));
      }
      await Promise.all(promises);

      return Response.json({ success: true });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
};
