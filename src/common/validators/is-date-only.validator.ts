import { estDateSeuleValide } from '../utils/date.util';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/** Vrai si `value` est une date calendaire `YYYY-MM-DD` existante. */
export const estDateOnly = estDateSeuleValide;

/** Décorateur : le champ doit être une date calendaire `YYYY-MM-DD`. */
export function IsDateOnly(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propriete: string | symbol): void => {
    registerDecorator({
      name: 'isDateOnly',
      target: object.constructor,
      propertyName: propriete as string,
      options,
      validator: {
        validate: (value: unknown) => estDateOnly(value),
        defaultMessage: (arguments_?: ValidationArguments) =>
          `${arguments_?.property ?? 'Le champ'} doit être une date au format AAAA-MM-JJ`,
      },
    });
  };
}
