import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import simulationsRouter from "./simulations";
import policiesRouter from "./policies";
import groupsRouter from "./groups";
import eventsRouter from "./events";

const router: IRouter = Router();

router.use(healthRouter);
router.use(agentsRouter);
router.use(simulationsRouter);
router.use(policiesRouter);
router.use(groupsRouter);
router.use(eventsRouter);

export default router;
