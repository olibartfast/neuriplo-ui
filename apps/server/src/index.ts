import Fastify from "fastify";

const app = Fastify({ logger: true });

const capabilities = {
  tasks: [
    "object_detection",
    "classification",
    "instance_segmentation",
    "pose_estimation",
    "depth_estimation",
    "optical_flow",
    "image_understanding",
  ],
  models: {
    object_detection: ["yolo26", "rtdetr", "rfdetr", "owlv2"],
  },
  backends: ["opencv_dnn", "onnx_runtime", "tensorrt", "openvino", "kserve"],
  sources: ["image", "video", "camera"],
};

app.get("/api/health", async () => ({ status: "ok" }));

// Temporary scaffold data. Replace this with neuriplo-infer --capabilities.
app.get("/api/capabilities", async () => capabilities);

app.post("/api/runs", async (_request, reply) => {
  return reply.code(501).send({
    status: "not_implemented",
    message: "neuriplo-infer runner integration is not implemented yet",
  });
});

const port = Number(process.env.PORT ?? 5174);
const host = process.env.HOST ?? "127.0.0.1";

await app.listen({ port, host });
