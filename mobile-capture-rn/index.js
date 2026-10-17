import { AppRegistry } from "react-native";
import { registerRootComponent } from "expo";

import App from "./App";
import { notificationHeadlessTask, NOTIFICATION_HEADLESS_TASK_NAME } from "./src/lib/capture";

AppRegistry.registerHeadlessTask(NOTIFICATION_HEADLESS_TASK_NAME, () => notificationHeadlessTask);
registerRootComponent(App);
