import fs from 'fs';

type Type = {
  string?: null,
  number?: null,
  boolean?: null,
  object?: Set<[string, Type]>,
  array?: Set<Type>,
  undefined?: null,
  unknown?: null,
}

type CompareTypes = (a: Type, b: Type) => boolean;

const checkEqualityWithoutOrder = (a: unknown[], b: unknown[]):boolean => {
  for (const elem of a) {
    if (!b.includes(elem)) {
      return false;
    }
  }
  return true;
}

const compareTypes:CompareTypes = (a,b) => {
  // have same value
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (!checkEqualityWithoutOrder(aKeys, bKeys)) return false;
  // check the object type and array type
  if (a.object && b.object) {
    // check that the props are the same
    const aProps = Array.from(a.object);
    const bProps = Array.from(b.object);
    const aKey = aProps.map(x => x[0]);
    const bKey = bProps.map(x => x[0]);
    // check the keys first
    if (!checkEqualityWithoutOrder(aKey, bKey)) return false;
    // check the values
    for (const [key, value] of aProps) {
      const bValue = bProps.find(x => x[0] === key);
      if (!bValue) return false;
      if (!compareTypes(value, bValue[1])) return false;
    }
  }
  if (a.array && b.array) {
    // check that the props are the same
    const aProps = Array.from(a.array);
    const bProps = Array.from(b.array);
    // check values
    for (const value of aProps) {
      if (!bProps.find(x => compareTypes(value, x))) return false;
    }
    for (const value of bProps) {
      if (!aProps.find(x => compareTypes(value, x))) return false;
    }
  }
  return true;
}

type DedupeTypes = (types: Type[]) => Type[];

const dedupeTypes:DedupeTypes = (types) => {
  const deduped:Type[] = [];
  for (const type of types) {
    if (!deduped.some(t => compareTypes(t, type))) {
      deduped.push(type);
    }
  }
  return deduped;
}

type InterpretType = (value: unknown) => Type

const interpretType: InterpretType = (value) => {
  if (typeof value === 'string') {
    return { string: null };
  }
  if (typeof value === 'number') {
    return { number: null };
  }
  if (typeof value === 'boolean') {
    return { boolean: null };
  }
  if (Array.isArray(value)) {
    let arrayTypes = dedupeTypes(value.map(interpretType));
    if (arrayTypes.length === 0) arrayTypes = [{ unknown: null }];
    return { array:  new Set(arrayTypes) };
  }
  if (value === undefined) {
    return { undefined: null };
  }
  if (value === null) {
    return { null: null };
  }
  if (typeof value === 'object') {
    let props = Object.entries(value).map(([key, value]) => [key, interpretType(value)]) as [string, Type][];
    if (props.length === 0) props = [["[k:string]", { unknown: null }]];
    return { object: new Set(props) };
  }
  throw new Error(`Unable to interpret type of ${value}`)
}

type MergeTypes = (a: Type, b: Type) => Type
const mergeTypes: MergeTypes = (a, b) => {
  let object, array = {};
  if(compareTypes(a, b)) {
    return a;
  }
  if (a.object && b.object) {
    // merge sets of props
    const aProps = Array.from(a.object);
    const bProps = Array.from(b.object);
    const sameKey = aProps.filter(([key]) => bProps.some(([key2]) => key === key2));
    const differentKeyA = aProps.filter(([key]) => !bProps.some(([key2]) => key === key2));
    const differentKeyB = bProps.filter(([key]) => !aProps.some(([key2]) => key === key2));
    // merge the same keys using the mergeTypes function
    const sameKeyMerged = sameKey.map(([key, type]) => {
      const type2 = bProps.find(([key2]) => key === key2);
      if (!type2) throw new Error('Something went wrong');
      return [key, mergeTypes(type, type2[1])] as [string, Type];
    });
    const differentKey = [...differentKeyA, ...differentKeyB];
    // add undefined
    const undefinedKey = differentKey.map(([key, type]) => [key, {...type, undefined: null}]) as [string, Type][];
    // return the merged type
    object = {object: new Set([...sameKeyMerged, ...undefinedKey])};
  }
  if (a.array && b.array) {
    // console.log(dedupeTypes([...Array.from(a.array), ...Array.from(b.array)]));
    // merge sets of types
    const arraySet = dedupeTypes([...Array.from(a.array), ...Array.from(b.array)]);
    // remove unknown type
    const arraySetWithoutunknown = arraySet.filter(x => x.unknown !== null);
    // if there is only one type, return it
    if (arraySetWithoutunknown.length === 0) {
      array = { array: new Set([{ unknown: null }]) };
    }
    else {
        // none of these can be compounded type (because not merged), we should merge object types
      const objectTypes = arraySet.filter(x => x.object);
      const arrayInArray = arraySet.filter(x => x.array);
      const everythingElse = arraySet.filter(x => !x.object && !x.array);
      const obj = (objectTypes.length > 1) ? [objectTypes.reduce(mergeTypes)] : objectTypes;
      const arr = (arrayInArray.length > 1) ? [arrayInArray.reduce(mergeTypes)] : arrayInArray;

      array = { array: new Set([...everythingElse, ...obj, ...arr]) };
    }
  }
  return {
    ...a,
    ...b,
    ...object,
    ...array,
  }
}
type ConvertToTypeString = (type: Type, level?:number) => string

const convertToTypeString: ConvertToTypeString = (type, level = 1) => {
  const copiedType = { ...type };
  const object = copiedType.object;
  const array = copiedType.array;
  delete copiedType.object;
  delete copiedType.array;

  const normalTypes = Object.keys(copiedType);
  let objectTypeString = '';
  let arrayTypeString = '';
  if (object) {
    objectTypeString = `{\n${Array.from(object).map(([key, type]) => Array(level).fill("\t").join('') + key + ((type.undefined === null) ? "?" : "") + " : " +
      convertToTypeString((() => {
        const copiedType = { ...type };
        delete copiedType.undefined;
        return copiedType;
      })(), level + 1)).join(',\n')}\n${level ? Array(level - 1).fill("\t").join('') : ''}}`;
  }
  if (array) {
    const typeStr = Array.from(array).map(t => convertToTypeString(t, level)).join(' | ')
    arrayTypeString = `${(array.size === 1 ) ? typeStr : "(" + typeStr + ")"}[]`;
  }
  const allTypes = [...normalTypes, objectTypeString, arrayTypeString].filter((str) => str.length);
  return `${allTypes.join(' | ')}`;
}

type ReplaceNullAndUndefinedWithunknownType = (type: Type) => Type

const replaceNullAndUndefinedWithunknownType: ReplaceNullAndUndefinedWithunknownType = (type) => {
  const keys = Object.keys(type);
  if(keys.length === 1 && (keys[0] === 'null' || keys[0] === 'undefined')) {
    return { unknown: null };
  }
  const object = type.object;
  const array = type.array;
  delete type.object;
  delete type.array;
  const newType = { ...type };
  if (object) {
    newType.object = new Set(Array.from(object).map(([key, type]) => [key, replaceNullAndUndefinedWithunknownType(type)]));
  }
  if (array) {
    newType.array = new Set(Array.from(array).map(replaceNullAndUndefinedWithunknownType));
  }
  return newType;
}

/**
 * This function produces the TypeScript Declaration file from the object array
 * @param array The array of objects to infer types from
 * @returns A string representing the TypeScript Declaration
 */
export function readTypeFromObjectArray<T>(array: T[]): string {
  const types = array.map(interpretType);
  const mergedType = types.reduce(mergeTypes);
  const type = replaceNullAndUndefinedWithunknownType(mergedType);
  const typeString = convertToTypeString(type);
  return `export type Data = ${typeString};`;
}

/**
 * This function read a JSON file and produces the TypeScript Declaration file from the object array
 * @param filePath The path to the file to read
 * @param outputPath The path to the output file
 */
export function readTypeFromDataFile(filePath: string, outputPath:string){
  const data = fs.readFileSync(filePath, 'utf8');
  const dataArray = JSON.parse(data) as unknown[];
  fs.writeFileSync(outputPath, readTypeFromObjectArray(dataArray));
}