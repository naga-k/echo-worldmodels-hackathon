import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PipelineProvider } from "@/context/PipelineContext";
import Index from "./pages/Index.tsx";
import Processing from "./pages/Processing.tsx";
import Experience from "./pages/Experience.tsx";
import Gallery from "./pages/Gallery.tsx";
import Diagnostics from "./pages/Diagnostics.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <PipelineProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/processing/:id" element={<Processing />} />
            <Route path="/experience/:id" element={<Experience />} />
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/diagnostics" element={<Diagnostics />} />
            {/* Legacy routes redirect */}
            <Route path="/processing" element={<Index />} />
            <Route path="/experience" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </PipelineProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
