// js/path.js
const identRe = /^[A-Za-z_$][\w$]*$/;

export const pathKey = (k) => identRe.test(k)
  ? `.${k}`
  : `["${String(k).replaceAll('\\','\\\\').replaceAll('"','\\"')}"]`;

export const pathIdx = (i) => `[${i}]`;

export function parsePath(path){
  if (!path || path[0] !== '$') throw new Error('bad path: ' + path);
  const tokens = [];
  let i = 1;
  while (i < path.length){
    const c = path[i];
    if (c === '.'){
      i++;
      let k = '';
      while (i < path.length && /[A-Za-z0-9_$]/.test(path[i])){ k += path[i]; i++; }
      tokens.push({kind:'key', value:k});
    } else if (c === '['){
      i++;
      if (path[i] === '"'){
        i++;
        let k = '';
        while (i < path.length && path[i] !== '"'){
          if (path[i] === '\\'){ k += path[i+1]; i += 2; }
          else { k += path[i]; i++; }
        }
        i++;
        if (path[i] === ']') i++;
        tokens.push({kind:'key', value:k});
      } else {
        let n = '';
        while (i < path.length && /\d/.test(path[i])){ n += path[i]; i++; }
        if (path[i] === ']') i++;
        tokens.push({kind:'idx', value:Number(n)});
      }
    } else { i++; }
  }
  return tokens;
}

export function walkPath(root, tokens){
  if (!tokens.length) return {parent:null, lastKey:null, isRoot:true};
  let cur = root;
  for (let i = 0; i < tokens.length - 1; i++){
    cur = cur[tokens[i].value];
    if (cur === undefined || cur === null) throw new Error('path miss at ' + i);
  }
  return {parent:cur, lastKey:tokens[tokens.length-1].value, isRoot:false};
}

export const estimateTokens = (chars) => chars <= 0 ? 0 : Math.max(1, Math.round(chars / 4));

export const fmtNum = (n) => n.toLocaleString();
