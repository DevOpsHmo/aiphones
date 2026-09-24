const JWT_FUTURE = /PGRST303|issued at future/i;

function isJwtIssuedInFuture(body: string) {
  return JWT_FUTURE.test(body);
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Reintenta cuando PostgREST rechaza el JWT por unos segundos de desfase de reloj. */
export function fetchRetryingJwtSkew(
  baseFetch: typeof fetch = fetch
): typeof fetch {
  return async (input, init) => {
    let response = await baseFetch(input, init);

    for (let attempt = 0; attempt < 5 && response.status >= 400; attempt += 1) {
      const body = await response.clone().text();
      if (!isJwtIssuedInFuture(body)) {
        break;
      }
      await delay(500 * (attempt + 1));
      response = await baseFetch(input, init);
    }

    return response;
  };
}
