import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { getTransmissionPodSpec } from "./constants.ts";
import ConfigPVC from "../shared/ConfigPVC.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { Container, Volume } from "../shared/imports/k8s.ts";
import ConfigMap from "../shared/ConfigMap.ts";
import Application from "../shared/Application.ts";
import { readTextFileSync } from "../shared/helpers.ts";
import { PodSpecProps } from "../shared/Pod.ts";

export class Reader extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "transmission" });

    const readerConfig = new ConfigPVC(this, { name: "reader-config" });
    const readerGluetunConfig = new GeneratedPassword(
      this,
      {
        name: "reader-gluetun-config",
        secretTemplate: {
          type: "Opaque",
          stringData: {
            "config.toml": readTextFileSync("gluetun-role-config.toml"),
            key: "$(value)",
          },
        },
      },
    );

    const seedboxUpdateScript = new ConfigMap(this, {
      name: "seedbox-update-script",
      data: {
        "dynamic-seedbox.sh": readTextFileSync("dynamic-seedbox.sh"),
      },
    });

    const seedboxVolume: Volume = {
      name: seedboxUpdateScript.name,
      configMap: {
        name: seedboxUpdateScript.name,
        defaultMode: 0o755,
      },
    };

    const seedboxUpdaterContainer: Container = {
      name: "seedbox-updater",
      image: "alpine/curl:8.12.1",
      restartPolicy: "Always",
      command: ["/mnt/dynamic-seedbox.sh"],
      volumeMounts: [{
        name: seedboxVolume.name,
        mountPath: "/mnt/dynamic-seedbox.sh",
        subPath: "dynamic-seedbox.sh",
      }, {
        name: readerConfig.name,
        mountPath: "/config",
      }],
    };

    const baseSpec = getTransmissionPodSpec(
      readerConfig.name,
      readerGluetunConfig.name,
    );
    const readerInitContainers = [
      seedboxUpdaterContainer,
      ...baseSpec.initContainers!,
    ];
    const readerVolumes = [seedboxVolume, ...baseSpec.volumes!];

    const readerPodSpecProps: PodSpecProps = {
      ...baseSpec,
      nasVolumeMounts: {
        transmission: [{
          mountPath: "/downloads",
          subPath: "downloads/reader"
        }]
      },
      initContainers: readerInitContainers,
      volumes: readerVolumes,
    };

    new Application(this, {
      name: "reader",
      podSpecProps: readerPodSpecProps,
      webPort: 9091,
      ingressRouteSpec: {
        useInsecureTransport: true,
      },
    });
  }
}
