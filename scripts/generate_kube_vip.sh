#!/bin/zsh

export VIP=192.168.53.100
export INTERFACE=eth0

export KVVERSION=v0.9.0

if [ -f kube-vip.yaml ]; then
  rm kube-vip.yaml
fi

docker run --rm --network host ghcr.io/kube-vip/kube-vip:$KVVERSION manifest daemonset --interface $INTERFACE --address $VIP --inCluster --taint --controlplane --services --arp --leaderElection > kube-vip.yaml
docker run --rm --network host ghcr.io/kube-vip/kube-vip:$KVVERSION manifest rbac --interface $INTERFACE --address $VIP --inCluster --controlplane --services --arp --leaderElection >> kube-vip.yaml