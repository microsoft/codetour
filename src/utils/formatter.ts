const $regex = /{{([a-z]+)(?:\|([a-z]+)(?::([a-z,]+))?(?::([a-z,]+))?)?}}/g;

export function formatter(format: string, properties: Record<string, unknown>): string {
	let match = $regex.exec(format);
	if(!match) {
		return format;
	}

	let result = '';
	let index = 0;

	while(match) {
		if(match.index > index) {
			result += format.slice(index, match.index);
		}

		if(match[2] === 'date') {
			const date = properties[match[1]] as Date;

			if(!match[3]) {
				result += String(date);
			}
			else if(match[3] === 'iso') {
				result += date.toISOString();
			}
			else {
				const locales = match[4] ? match[4].split(',') : undefined;
				const options: {
					dateStyle: string | undefined;
					timeStyle: string | undefined;
				} = {
					dateStyle: undefined,
					timeStyle: undefined,
				};

				const styles = match[3].split(',');

				if(styles[0]) {
					options.dateStyle = styles[0];
				}

				if(styles[1]) {
					options.timeStyle = styles[1];
				}

				const formatter = new Intl.DateTimeFormat(locales, options as any);

				result += formatter.format(date);
			}
		}
		else {
			result += String(properties[match[1]]);
		}

		index = match.index + match[0].length;
		match = $regex.exec(format);
	}

	result += format.slice(index, format.length);

	return result;
}
