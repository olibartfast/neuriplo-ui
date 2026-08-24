import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const options = {
  tasks: ["Object Detection", "Classification", "Instance Segmentation", "Pose Estimation", "Depth Estimation", "Optical Flow", "Image Understanding"],
  models: ["yolo26", "rtdetr", "rfdetr", "owlv2", "depth_anything_v2", "gemma4"],
  backends: ["OpenCV DNN", "ONNX Runtime", "TensorRT", "OpenVINO", "KServe"],
  sources: ["Image", "Video", "Camera"],
};

function App() {
  return (
    <main className="page-shell">
      <header>
        <p className="eyebrow">Neuriplo</p>
        <h1>Inference Pipeline</h1>
        <p className="subtitle">Configure and exercise the Neuriplo inference stack end to end.</p>
      </header>

      <section className="panel" aria-label="Pipeline configuration">
        <div className="grid">
          <Select label="Task" testId="task" values={options.tasks} />
          <Select label="Model" testId="model" values={options.models} />
          <Select label="Inference backend" testId="backend" values={options.backends} />
          <Select label="Source" testId="source" values={options.sources} />
        </div>
        <button data-testid="run" type="button" disabled>
          Run inference
        </button>
        <p className="hint">Runner integration is the next milestone.</p>
      </section>

      <section className="panel empty-state" aria-label="Run result">
        <span data-testid="run-status">Idle</span>
        <p>Results, latency, logs, and generated artifacts will appear here.</p>
      </section>
    </main>
  );
}

function Select({ label, testId, values }: { label: string; testId: string; values: string[] }) {
  return (
    <label>
      <span>{label}</span>
      <select data-testid={testId} defaultValue={values[0]}>
        {values.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
    </label>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
