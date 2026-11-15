/** Представление EndpointSlice для учебной схемы; не симуляция kube-proxy/CNI. */
export interface EndpointExample {
  address: string;
  pod: string;
  ready: boolean;
  serving: boolean;
  terminating: boolean;
}

export function endpointRows(endpoints: EndpointExample[]) {
  return endpoints.map((endpoint) => ({
    t: `${endpoint.pod} · ${endpoint.address}`,
    ok: endpoint.ready,
    reason: endpoint.terminating
      ? 'в EndpointSlice: terminating=true, ready=false'
      : endpoint.ready ? 'ready=true: обычный трафик разрешён' : 'в EndpointSlice: ready=false',
  }));
}
